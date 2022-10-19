    // SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.14;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./IHashStratDAOToken.sol";
import "./IDivsDistributor.sol";


/**
 * This contract allows to distribute dividends to DAO token holders.
 *
 * The Owner of this contact should be DAOOperations that will be allow to
 * suspend or change the distribution periods.
 *
 */

contract DivsDistributor is Ownable, IDivsDistributor {

    event DistributionIntervalCreated(uint paymentIntervalId, uint dividendsAmount, uint blockFrom, uint blockTo);
    event DividendsClaimed(address indexed recipient, uint amount);


    uint immutable MIN_BLOCKS_INTERVAL = 1 * 24 * 60 * 60 / 2; 
    uint immutable MAX_BLOCKS_INTERVAL = 90 * 24 * 60 * 60 / 2; 

    // Number of blocks for a payment interval
    uint public paymentInterval = 30 * 24 * 60 * 60 / 2; // 30 days (Polygon block time is ~ 2s)


    // The DAO token to distribute to stakers
    IHashStratDAOToken immutable public hstToken;
    IERC20Metadata immutable public feesToken;

    uint public totalDivsPaid;
    uint public minDistributionAmount;
    DistributionInterval[] public distributionIntervals;


    struct DistributionInterval {
        uint id;
        uint reward;    // the divs to be distributed
        uint from;      // block number
        uint to;        // block number
        uint rewardsPaid;
    }

    // distribution_interval_id => ( account => claimed_amount) 
    mapping(uint => mapping(address => uint)) claimed;


    constructor(address feesTokenAddress, address hstTokenAddress) {
        feesToken = IERC20Metadata(feesTokenAddress);
        hstToken = IHashStratDAOToken(hstTokenAddress);

        minDistributionAmount = 10 ** feesToken.decimals();
    }


    function getDistributionIntervals() public view returns (DistributionInterval[] memory) {
        return distributionIntervals;
    }


    function getDistributionIntervalsCount() public view returns (uint) {
        return distributionIntervals.length;
    }


    function claimableDivs(address account) public view returns (uint divs) {

        if (distributionIntervals.length == 0) return 0;

        DistributionInterval memory distribution = distributionIntervals[distributionIntervals.length - 1];

        if (distribution.from >= block.number) return 0;

        if (claimedDivs(distribution.id, account) == 0) {
            uint tokens = hstToken.getPastVotes(account, distribution.from);
            uint totalSupply = hstToken.getPastTotalSupply(distribution.from);

            divs = totalSupply > 0 ? distribution.reward * tokens / totalSupply : 0;
        }

        return divs;
    }


    function claimedDivs(uint distributionId, address account) public view returns (uint) {
        return claimed[distributionId][account];
    }


    // transfer dividends to sender
    function claimDivs() public {
        uint divs = claimableDivs(msg.sender);
        if (divs > 0) {
            DistributionInterval storage distribution = distributionIntervals[distributionIntervals.length - 1];
            claimed[distribution.id][msg.sender] = divs;
            distribution.rewardsPaid += divs;
            totalDivsPaid += divs;

            feesToken.transfer(msg.sender, divs);

            emit DividendsClaimed(msg.sender, divs);
        }
    }


    ///// IDivsDistributor
    
    function canCreateNewDistributionInterval() public view returns (bool) {
        return feesToken.balanceOf(address(this)) >= minDistributionAmount &&
               (distributionIntervals.length == 0 || block.number > distributionIntervals[distributionIntervals.length-1].to);
    }


    // Add a new reward period.
    // Requires to be called after the previous period ended and requires positive 'feesToken' balance
    function addDistributionInterval() external {
        require(canCreateNewDistributionInterval(), "Cannot create distribution interval");

        uint from = distributionIntervals.length == 0 ? block.number : distributionIntervals[distributionIntervals.length-1].to + 1;
        uint to = block.number + paymentInterval;

        // determine the reward amount
        uint reward = feesToken.balanceOf(address(this));
        distributionIntervals.push(DistributionInterval(distributionIntervals.length+1, reward, from, to, 0));

        emit DistributionIntervalCreated(distributionIntervals.length, reward, from, to);
    }


    //// OnlyOwner functionality
    function setDivsDistributionInterval(uint blocks) public onlyOwner {
        require (blocks >= MIN_BLOCKS_INTERVAL && blocks <= MAX_BLOCKS_INTERVAL, "Invalid payment interval");
        paymentInterval = blocks;
    }

    function setMinDistributionAmount(uint amount) public onlyOwner {
        require (amount > 0, "Invalid amount");

        minDistributionAmount = amount;
    }

}