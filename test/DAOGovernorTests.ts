import { expect } from "chai";
import { ethers, network } from "hardhat";

import { Contract  } from "ethers"
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";


import abis from "./abis/abis.json";
import { toWei, mineBlocks } from "./helpers";

const usdcAddress = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
const usdcSource = '0xe7804c37c13166ff0b37f5ae0bb07a3aebb6e245' // rich account owing 48,354,222.149244  USDC
const poolOwner = '0x4F888d90c31c97efA63f0Db088578BB6F9D1970C'


describe("HashStratGovernor", function () {

	async function deployGovernorFixture() {

		const HashStratDAOToken = await ethers.getContractFactory("HashStratDAOToken");
		const hashStratDAOToken = await HashStratDAOToken.deploy()
		await hashStratDAOToken.deployed()

		// set farm address to allow owner to mint tokens
		const [owner] = await ethers.getSigners();
		await hashStratDAOToken.setFarmAddress(owner.address)

		// Deploy TimelockController without any proposers. 
		// At deployment the deployer account receives an admin role that can be used to add a proposer later (see the TimelockController Roles docs section).
		// A common use case is to position TimelockController as the owner of a smart contract, with a DAO (Governor) as the sole proposer.
		const TimelockController = await ethers.getContractFactory("HashStratTimelockController");
		const timelockDelay = 0
		const timelockController = await TimelockController.deploy(timelockDelay)
		await timelockController.deployed()

		const TIMELOCK_ADMIN_ROLE = await timelockController.TIMELOCK_ADMIN_ROLE()
		const PROPOSER_ROLE = await timelockController.PROPOSER_ROLE()
		const EXECUTOR_ROLE = await timelockController.EXECUTOR_ROLE()

		// Deploy Governor with GovernorTimelockControl, connected to the timelock that was just deployed.
		const initialVotingDelay = 0
		const initialVotingPeriod = 1000
		const initialProposalThreshold = 0
		const initialQuorumFraction = 10  // 10% quorum

		const HashStratGovernor = await ethers.getContractFactory("HashStratGovernor");
		const hashStratGovernor = await HashStratGovernor.deploy(
			hashStratDAOToken.address, 
			timelockController.address, 
			initialVotingDelay, 
			initialVotingPeriod,
			initialProposalThreshold,
			initialQuorumFraction
		)
		await hashStratGovernor.deployed()

		// Add the Governor as a proposer and executor roles 
		//TODO renounce the timelock admin role from the deployer account.
		await timelockController.grantRole(EXECUTOR_ROLE, hashStratGovernor.address)
		await timelockController.grantRole(PROPOSER_ROLE, hashStratGovernor.address)

		// the existing usdc contract on the network
		const usdc = new Contract(usdcAddress, abis["erc20"], ethers.provider)

		const Treasury = await ethers.getContractFactory("Treasury");
		const treasury = await Treasury.deploy(usdcAddress)
		await treasury.deployed()

		const HashStratDAOTokenFarm = await ethers.getContractFactory("HashStratDAOTokenFarm")
		const hashStratDAOTokenFarm = await HashStratDAOTokenFarm.deploy(hashStratDAOToken.address)
		await hashStratDAOTokenFarm.deployed();

		const DivsDistributor = await ethers.getContractFactory("DivsDistributor");
		const divsDistributor = await DivsDistributor.deploy(usdcAddress, hashStratDAOToken.address)
		await divsDistributor.deployed()

		// DAO Operations
		const DAOOperations = await ethers.getContractFactory("DAOOperations");
		const daoOperations = await DAOOperations.deploy(usdc.address, treasury.address, divsDistributor.address, hashStratDAOTokenFarm.address) // don't need DivsDistributor
		await daoOperations.deployed()

		// DAOOperations should own HashStratDAOTokenFarm and Treasury
		await treasury.transferOwnership(daoOperations.address)
		await hashStratDAOTokenFarm.transferOwnership(daoOperations.address)

		const poolAddresses = [pools.pool01v3a.pool, pools.pool01v3a.pool, pools.pool01v3a.pool, pools.pool01v3a.pool, pools.pool01v3a.pool, pools.pool01v3a.pool]
		await daoOperations.addPools(poolAddresses)

		// HashStratTimelockController must own DAOOperations to execute DAOOperations onlyOwner functions
		await daoOperations.transferOwnership(timelockController.address) 


		return { hashStratDAOToken, timelockController, hashStratGovernor, daoOperations, treasury, usdc, timelockDelay };
	}


	describe("TimelockController", function () {

		it("has Proposer role", async function () {
			const { timelockController, hashStratGovernor } = await loadFixture(deployGovernorFixture);
			const PROPOSER_ROLE = await timelockController.PROPOSER_ROLE()

			expect( await timelockController.hasRole(PROPOSER_ROLE, hashStratGovernor.address) ).to.be.true
		});

		it("has Executor role", async function () {
			const { timelockController, hashStratGovernor } = await loadFixture(deployGovernorFixture);
			const EXECUTOR_ROLE = await timelockController.EXECUTOR_ROLE()

			expect( await timelockController.hasRole(EXECUTOR_ROLE, hashStratGovernor.address) ).to.be.true
		});

		it("has no delay", async function () {
			const { timelockController, hashStratGovernor } = await loadFixture(deployGovernorFixture);
			const EXECUTOR_ROLE = await timelockController.EXECUTOR_ROLE()

			expect( await timelockController.getMinDelay() ).to.be.equal( 0 )
		});

		it("can increase delay via proposal", async function () {

			const [ owner, proposer, voter ] = await ethers.getSigners();
			const { hashStratGovernor, hashStratDAOToken, timelockController } = await loadFixture(deployGovernorFixture);

			hashStratDAOToken.connect(voter).autoDelegate()

			// transfer some tokens to voter
			await hashStratDAOToken.connect(owner).mint( voter.address, toWei('100000') )

		
			// Submit proposal to transfer 1000 USDC from 'daoOperations' to 'recepient'
			const description = "Proposal #1: Increase timelock delay"

			// new delay of 7 days
			const newDelay = 7 * 24 * 60 * 60

			const transferCalldata = timelockController.interface.encodeFunctionData('updateDelay', [newDelay]);
			await hashStratGovernor.connect(proposer)["propose(address[],uint256[],bytes[],string)"] (
				[timelockController.address],
				[0],  // no ether to send
				[transferCalldata],
				description
			);

			// get proposal state by proposalId
			const proposalId = await hashStratGovernor.hashProposal(
				[timelockController.address],
				[0],
				[transferCalldata],
				ethers.utils.id(description)
			)

			/// Cast vote on proposal (Against: 0, For: 1, Abstain: 2)
			await hashStratGovernor.connect(voter).castVote(proposalId, 1)

			await mineBlocks(1000) // wait for the end of the proposal period
			const proposalState = await hashStratGovernor.state(proposalId)

			const Succeeded = 4
			expect( proposalState ).to.be.equal(Succeeded)

			
			// queue proposal for execution
			await hashStratGovernor["queue(address[],uint256[],bytes[],bytes32)"](
				[timelockController.address],
				[0],
				[transferCalldata],
				ethers.utils.id(description)
			);

			// execute proposal 
			await hashStratGovernor["execute(address[],uint256[],bytes[],bytes32)"](
				[timelockController.address],
				[0],
				[transferCalldata],
				ethers.utils.id(description)
			);



			expect( await timelockController.getMinDelay() ).to.be.equal( newDelay )
		});

	});


	describe("Proposals", function () {

		it("creates a new proposal", async function () {

			const [ proposer, recepient ] = await ethers.getSigners();
			const { hashStratGovernor, daoOperations, usdc } = await loadFixture(deployGovernorFixture);

			// Submit proposal
			const transferCalldata = usdc.interface.encodeFunctionData('transfer', [recepient.address, 1000 * 10 ** 6]);
			await hashStratGovernor.connect(proposer)["propose(address[],uint256[],bytes[],string)"] (
				[daoOperations.address],
				[0],
				[transferCalldata],
				"Proposal #1: Transfer USDC to address"
			);

			// get proposal state by proposalId
			const proposalId = await hashStratGovernor.hashProposal(
				[daoOperations.address],
				[0],
				[transferCalldata],
				ethers.utils.id("Proposal #1: Transfer USDC to address")  // hash of the proposal description
			)
			const proposalState = await hashStratGovernor.state(proposalId)

			const Pending = 0
			expect( proposalState ).to.be.equal(Pending)
		});


		it("pass a proposal if support votes pass the quorum", async function () {

			const [ owner, proposer, voter, recepient ] = await ethers.getSigners();
			const { hashStratGovernor, hashStratDAOToken, daoOperations, usdc } = await loadFixture(deployGovernorFixture);

			// voter delegates themselves
			hashStratDAOToken.connect(voter).autoDelegate()

			// mint some tokens to the owner
			await hashStratDAOToken.connect(owner).mint( owner.address, toWei('9000') )

			// mint some tokens to voter (just enough to pass the 10% quorum)
			await hashStratDAOToken.connect(owner).mint( voter.address, toWei('1000') )

			// Submit proposal
			const transferCalldata = usdc.interface.encodeFunctionData('transfer', [recepient.address, 1000 * 10 ** 6]);
			await hashStratGovernor.connect(proposer)["propose(address[],uint256[],bytes[],string)"] (
				[daoOperations.address],
				[0],
				[transferCalldata],
				"Proposal #1: Transfer USDC to address"
			);

			// get proposal state by proposalId
			const proposalId = await hashStratGovernor.hashProposal(
				[daoOperations.address],
				[0],
				[transferCalldata],
				ethers.utils.id("Proposal #1: Transfer USDC to address")  // hash of the proposal description
			)

			/// Vote for the proposal (Against: 0, For: 1, Abstain: 2)
			await hashStratGovernor.connect(voter).castVote(proposalId, 1)
			await mineBlocks(1000) // wait for the end of the proposal period

			// verify the proposal has succeeded
			const proposalState = await hashStratGovernor.state(proposalId)
			const Succeeded = 4
			expect( proposalState ).to.be.equal(Succeeded)
		});


		it("reject a proposal if support votes are below the quorum", async function () {

			const [ owner, proposer, voter, recepient ] = await ethers.getSigners();
			const { hashStratGovernor, hashStratDAOToken, daoOperations, usdc } = await loadFixture(deployGovernorFixture);

			// voter delegates themselves
			hashStratDAOToken.connect(voter).autoDelegate()

			// mint some tokens to the owner
			await hashStratDAOToken.connect(owner).mint( owner.address, toWei('9000') )

			// mint some tokens to voter (not enough to pass the 10% quorum)
			await hashStratDAOToken.connect(owner).mint( voter.address, toWei('999') )

			// Submit proposal
			const transferCalldata = usdc.interface.encodeFunctionData('transfer', [recepient.address, 1000 * 10 ** 6]);
			await hashStratGovernor.connect(proposer)["propose(address[],uint256[],bytes[],string)"] (
				[daoOperations.address],
				[0],
				[transferCalldata],
				"Proposal #1: Transfer USDC to address"
			);

			// get proposal state by proposalId
			const proposalId = await hashStratGovernor.hashProposal(
				[daoOperations.address],
				[0],
				[transferCalldata],
				ethers.utils.id("Proposal #1: Transfer USDC to address")  // hash of the proposal description
			)

			/// Vote for the proposal (Against: 0, For: 1, Abstain: 2)
			await hashStratGovernor.connect(voter).castVote(proposalId, 1)
			await mineBlocks(1000) // wait for the end of the proposal period

			// verify the proposal has succeeded
			const proposalState = await hashStratGovernor.state(proposalId)
			const Failed = 3
			expect( proposalState ).to.be.equal(Failed)
		});


		it("execute a succesful proposal", async function () {

			const [ owner, proposer, voter, recepient ] = await ethers.getSigners();
			const { hashStratGovernor, hashStratDAOToken, daoOperations, treasury, usdc } = await loadFixture(deployGovernorFixture);

			hashStratDAOToken.connect(voter).autoDelegate()

			// transfer some tokens to voter
			await hashStratDAOToken.connect(owner).mint( voter.address, toWei('100000') )

			// transfer USDC to daoOperations
			const feesAmount = 1000 * 10 ** 6
			await transferFunds( feesAmount, treasury.address )

			// Submit proposal to transfer 1000 USDC from 'daoOperations' to 'recepient'
			const description = "Proposal #1: Transfer USDC to recipient address"


			const transferCalldata = daoOperations.interface.encodeFunctionData('transferFunds', [recepient.address, feesAmount]);
			await hashStratGovernor.connect(proposer)["propose(address[],uint256[],bytes[],string)"] (
				[daoOperations.address],
				[0],
				[transferCalldata],
				description
			);

			// get proposal state by proposalId
			const proposalId = await hashStratGovernor.hashProposal(
				[daoOperations.address],
				[0],
				[transferCalldata],
				ethers.utils.id(description)
			)

			/// Cast vote on proposal (Against: 0, For: 1, Abstain: 2)
			await hashStratGovernor.connect(voter).castVote(proposalId, 1)

			await mineBlocks(1000) // wait for the end of the proposal period
			const proposalState = await hashStratGovernor.state(proposalId)

			const Succeeded = 4
			expect( proposalState ).to.be.equal(Succeeded)

			const recipientBalanceBefore = await usdc.balanceOf(recepient.address)

			// queue proposal for execution
			await hashStratGovernor["queue(address[],uint256[],bytes[],bytes32)"](
				[daoOperations.address],
				[0],
				[transferCalldata],
				ethers.utils.id(description)
			);

			// execute proposal 
			await hashStratGovernor["execute(address[],uint256[],bytes[],bytes32)"](
				[daoOperations.address],
				[0],
				[transferCalldata],
				ethers.utils.id(description)
			);

			// verify fees have been transferred to recipient
			const recipientBalanceAfter = await usdc.balanceOf(recepient.address)
			expect( recipientBalanceAfter ).to.be.equal( recipientBalanceBefore.add(feesAmount) )
		});


	});


	describe("HashStratGovernor", function () {

		it("has initial 10% quorum", async function () {
			const { hashStratGovernor } = await loadFixture(deployGovernorFixture);
			
			expect( await hashStratGovernor["quorumNumerator()"]() ).to.be.equal( 10 )
		});


		it("can increase quorum via proposal", async function () {

			const [ owner, proposer, voter ] = await ethers.getSigners();
			const { hashStratGovernor, hashStratDAOToken, timelockController } = await loadFixture(deployGovernorFixture);

			hashStratDAOToken.connect(voter).autoDelegate()

			// transfer some tokens to voter
			await hashStratDAOToken.connect(owner).mint( voter.address, toWei('100000') )

			// new quorum of 50%
			const newQuorumNumerator = 50
			const description = "Proposal #1: Increase quorum"

			const transferCalldata = hashStratGovernor.interface.encodeFunctionData('updateQuorumNumerator', [newQuorumNumerator]);
			await hashStratGovernor.connect(proposer)["propose(address[],uint256[],bytes[],string)"] (
				[hashStratGovernor.address],
				[0],  // no ether to send
				[transferCalldata],
				description
			);

			// get proposal state by proposalId
			const proposalId = await hashStratGovernor.hashProposal(
				[hashStratGovernor.address],
				[0],
				[transferCalldata],
				ethers.utils.id(description)
			)

			/// Cast vote on proposal (Against: 0, For: 1, Abstain: 2)
			await hashStratGovernor.connect(voter).castVote(proposalId, 1)

			await mineBlocks(1000) // wait for the end of the proposal period
			const proposalState = await hashStratGovernor.state(proposalId)

			const Succeeded = 4
			expect( proposalState ).to.be.equal(Succeeded)

			
			// queue proposal for execution
			await hashStratGovernor["queue(address[],uint256[],bytes[],bytes32)"](
				[hashStratGovernor.address],
				[0],
				[transferCalldata],
				ethers.utils.id(description)
			);

			// execute proposal 
			await hashStratGovernor["execute(address[],uint256[],bytes[],bytes32)"](
				[hashStratGovernor.address],
				[0],
				[transferCalldata],
				ethers.utils.id(description)
			);



			expect( await hashStratGovernor["quorumNumerator()"]() ).to.be.equal( newQuorumNumerator )
		});

	});


})


async function transferFunds(amount: number | string, recipient: string) {

	const usdc = new Contract(usdcAddress, abis["erc20"], ethers.provider)

	// impersonate 'account'
	await network.provider.request({
		method: "hardhat_impersonateAccount",
		params: [usdcSource],
	});
	const signer = await ethers.getSigner(usdcSource);
	await usdc.connect(signer).transfer(recipient, amount)
}




// Polygon Pools
const pools = {
	"pool01v3a": {
		"pool": "0x8714336322c091924495B08938E368Ec0d19Cc94",
		"pool_lp": "0x49c3ad1bF4BeFb024607059cb851Eb793c224BaB",
		"strategy": "0xbfB7A8caF44fD28188673B09aa3B2b00eF301118",
		"price_feed": "0xc907E116054Ad103354f2D350FD2514433D57F6f"
	},
	"pool02v3a": {
		"pool": "0xD963e4C6BE2dA88a1679A40139C5b75961cc2619",
		"pool_lp": "0xC27E560E3D1546edeC5DD858D404EbaF2166A763",
		"strategy": "0xc78BD1257b7fE3Eeb33fC824313C71D145C9754b",
		"price_feed": "0xF9680D99D6C9589e2a93a78A04A279e509205945"
	},
	"pool03v3a": {
		"pool": "0x63151e56140E09999983CcD8DD05927f9e8be81D",
		"pool_lp": "0xCdf8886cEea718ad37e02e9a421Eb674F20e5ba1",
		"strategy": "0x4687faf8e60ca8e532af3173C0225379939261F7",
		"price_feed": "0xc907E116054Ad103354f2D350FD2514433D57F6f"
	},
	"pool04v3a": {
		"pool": "0xd229428346E5Ba2F08AbAf52fE1d2C941ecB36AD",
		"pool_lp": "0xe4FF896D756Bdd6aa1208CDf05844335aEA56297",
		"strategy": "0xB98203780925694BAeAFDC7CB7C6ECb1E6631D17",
		"price_feed": "0xF9680D99D6C9589e2a93a78A04A279e509205945"
	},
	"pool05v3a": {
		"pool": "0xCfcF4807d10C564204DD131527Ba8fEb08e2cc9e",
		"pool_lp": "0x80bc0b435b7e7F0Dc3E95C3dEA87c68D5Ade4378",
		"strategy": "0xBbe4786c0D1cEda012B8EC1ad12a2F7a1A5941f1",
		"price_feed": "0xc907E116054Ad103354f2D350FD2514433D57F6f"
	},
	"pool06v3a": {
		"pool": "0xa2f3c0FDC55814E70Fdac2296d96bB04840bE132",
		"pool_lp": "0x2523c4Ab54f5466A8b8eEBCc57D8edC0601faB54",
		"strategy": "0x62386A92078CC4fEF921F9bb1f515464e2f7918f",
		"price_feed": "0xF9680D99D6C9589e2a93a78A04A279e509205945"
	},
}
