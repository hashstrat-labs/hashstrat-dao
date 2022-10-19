// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.14;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/draft-ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";


/**
 * The token of the HashStrat DAO
 *
 * HashStrat DAO Token (HST) has a MAX_SUPPLY of 1_000_000 units that get minted by HashStratDAOTokenFarm
 * to HashStrat liquidity providers over a 10 years period.
 *
 * Users that provide liquidity into HashStrat Pools and Indexex, receive LP tokens that can be staked
 * in HashStratDAOTokenFarm to earn HST tokens that allow to partecipate in the DAO governance and revenue share programs.
 *
 */


contract HashStratDAOToken is ERC20, ERC20Permit, ERC20Votes {

    /**
     * @dev Throws if called by any account other than the token farm.
    */
    modifier onlyFarm() {
        require(farmAddress == msg.sender, "HashStratDAOToken: caller is not the token farm");
        _;
    }

    uint224 public MAX_SUPPLY = uint224(1_000_000 * 10 ** decimals());

    address public farmAddress;

    constructor() ERC20("HashStratDAOToken", "HST") ERC20Permit("HashStratDAOToken") { }


    function setFarmAddress(address _farmAddress) public {
        require(farmAddress == address(0), "Farm address already set");
       
        farmAddress = _farmAddress;
    }


    function maxSupply() external view returns (uint) {
        return _maxSupply();
    }


    function autoDelegate() external {
        super._delegate(msg.sender, msg.sender);
    }


    function delegate(address delegator, address delegatee) public onlyFarm {
        super._delegate(delegator, delegatee);
    }


    function mint(address to, uint256 amount) public onlyFarm {
        _mint(to, amount);
    }


    function _afterTokenTransfer(address from, address to, uint256 amount) internal override(ERC20, ERC20Votes) {
        super._afterTokenTransfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal override(ERC20, ERC20Votes) {
        super._mint(to, amount);
    }


    function _burn(address account, uint256 amount) internal override(ERC20, ERC20Votes) {
        super._burn(account, amount);
    }
    

    function _maxSupply() internal view override returns (uint224) {
        return MAX_SUPPLY;
    }
}