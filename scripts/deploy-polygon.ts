import { ethers } from "hardhat";
import { Contract, BigNumber } from "ethers"


import abis from "./abis/abis.json";

const usdcAddress = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'


const hashStratDAOTokenAddress = '0x969D08DaA45663b6066a172b8Ea57cd1F9d5A3C9'
const hashStratDAOTokenFarmAddress = '0xF3515ED3E4a93185ea16D11A870Cf6Aa65a41Ec7'
const treasuryAddress = '0xD54085586F2eA6080e5e7cc3D6c022A2AEC47f3c'
const divsDistributorAdddress = '0x5087950307FBE0305CBeC729F752215ad6034f80'
const daoOperations = '0x7d49433360930dDed0B118fA0C9cAF9a38D18155'

const timelockAddress = '0x50BeD9c1D6f47B3fB580179a2B8a855CD62b019b'
const governorAddress = '0xEEE17dd25c6ac652c434977D291b016b9bA61a1A'

const timelockDelay = 43200  			  //// In blocks (approximately 1 day)
const initialVotingDelay = 0			  //// Can vote immediately on a new proposal
const initialVotingPeriod =  2 * 43200    //// in blocks (approximately 2 days)
const initialProposalThreshold = 1000     //// 1000 HST tokens required to create a proposal
const initialQuorumFraction = 50  		  //// 50% quorum


async function main() {
	await depolyHashStratDAOTokenAndFarm()
	await deployTreasuryAndDivsDistributor(usdcAddress, hashStratDAOTokenAddress)
	await deployDAOOperations(usdcAddress, treasuryAddress, divsDistributorAdddress, hashStratDAOTokenFarmAddress)
	await addPoolsAndIndexesToDaoOperations(daoOperations)
	await deployGovernor(hashStratDAOTokenAddress, timelockDelay, initialVotingDelay, initialVotingPeriod, initialProposalThreshold, initialQuorumFraction)
}


const deployGovernor = async (  hashStratDAOTokenAddress: string,
								timelockDelay: number, 
								initialVotingDelay: number, 
								initialVotingPeriod: number, 
								initialProposalThreshold: number,
								initialQuorumFraction: number,
								) => {

		// Deploy TimelockController without any proposers. 
		// At deployment the deployer account receives an admin role that can be used to add a proposer later (see the TimelockController Roles docs section).
		// A common use case is to position TimelockController as the owner of a smart contract, with a DAO (Governor) as the sole proposer.
		const HashStratTimelockController = await ethers.getContractFactory("HashStratTimelockController");
		const timelockController = await HashStratTimelockController.deploy(timelockDelay)
		await timelockController.deployed()
		console.log("HashStratTimelockController deployed at address ", timelockController.address)

		// Deploy Governor with GovernorTimelockControl, connected to the timelock that was just deployed.
		const HashStratGovernor = await ethers.getContractFactory("HashStratGovernor");
		const hashStratGovernor = await HashStratGovernor.deploy(
			hashStratDAOTokenAddress, 
			timelockController.address, 
			initialVotingDelay, 
			initialVotingPeriod,
			initialProposalThreshold,
			initialQuorumFraction
		)
		await hashStratGovernor.deployed()

		console.log("HashStratGovernor deployed at address ", hashStratGovernor.address)

		const TIMELOCK_ADMIN_ROLE = await timelockController.TIMELOCK_ADMIN_ROLE()
		const PROPOSER_ROLE = await timelockController.PROPOSER_ROLE()
		const EXECUTOR_ROLE = await timelockController.EXECUTOR_ROLE()

		await timelockController.grantRole(PROPOSER_ROLE, hashStratGovernor.address)
		await timelockController.grantRole(EXECUTOR_ROLE, hashStratGovernor.address)

		console.log("HashStratGovernor EXECUTOR_ROLE and PROPOSER_ROLE to HashStratGovernor address: ", hashStratGovernor.address)

}



const depolyHashStratDAOTokenAndFarm = async () => {

	///////  Deploy HashStratDAOToken 

	console.log("Starting deployment of HashStratDAOToken on POLYGON")
	const HashStratDAOToken = await ethers.getContractFactory("HashStratDAOToken");
	const hashStratDAOToken = await HashStratDAOToken.deploy()
	await hashStratDAOToken.deployed()

	console.log("HashStratDAOToken deployed at address:", hashStratDAOToken.address);

	/////// Deploy HashStratDAOTokenFarm

	console.log("Starting deployment of HashStratDAOTokenFarm: on POLYGON")
	const HashStratDAOTokenFarm = await ethers.getContractFactory("HashStratDAOTokenFarm");

  	const hashStratDAOTokenFarm = await HashStratDAOTokenFarm.deploy(hashStratDAOToken.address);
	await hashStratDAOTokenFarm.deployed();
	console.log("HashStratDAOTokenFarm deployed at address:", hashStratDAOTokenFarm.address);


	// Set farm address for HashStratDAOToken
	await hashStratDAOToken.setFarmAddress(hashStratDAOTokenFarm.address)

	// Add reward phases to Farm
	await hashStratDAOTokenFarm.addRewardPeriods()
	console.log("rewards periods created: ", (await hashStratDAOTokenFarm.rewardPeriodsCount()).toString() )


	return hashStratDAOTokenFarm.address
}



const deployTreasuryAndDivsDistributor = async (usdcAddress: string, hashStratDAOTokenAddress: string) => {

	console.log("Starting deployment of Treasury on POLYGON")

	const Treasury = await ethers.getContractFactory("Treasury");
	const treasury = await Treasury.deploy(usdcAddress)
	await treasury.deployed()
	
	console.log("Treasury deployed at address ", treasury.address)
	console.log("Starting deployment of DivsDistributor on POLYGON")

	const DivsDistributor = await ethers.getContractFactory("DivsDistributor");
	const divsDistributor = await DivsDistributor.deploy(usdcAddress, hashStratDAOTokenAddress)
	await divsDistributor.deployed()

	console.log("DivsDistributor deployed at address ", divsDistributor.address)
	console.log("DivsDistributor distribution intervals: ", await divsDistributor.getDistributionIntervalsCount() )
}


const deployDAOOperations = async (usdcAddress: string, treasuryAddress: string, divsDistributorAdddress: string, tokenFarmAddress: string) => {

	// DAO Operations
	const DAOOperations = await ethers.getContractFactory("DAOOperations");
	const daoOperations = await DAOOperations.deploy(usdcAddress, treasuryAddress, divsDistributorAdddress, tokenFarmAddress)
	await daoOperations.deployed()

	console.log("DAOOperations deployed to address: ", daoOperations.address)


	// // DAOOperations should own Treasury and hashStratDAOTokenFarm
	// const treasury = new Contract(treasuryAddress, abis['treasury'], ethers.provider)
	// await treasury.transferOwnership(daoOperations.address)
	// console.log("Treasury ownership transferred to DaoOperations: ", daoOperations.address)

	// const hashStratDAOTokenFarm = new Contract(tokenFarmAddress, abis['hst_farm'], ethers.provider)
	// await hashStratDAOTokenFarm.transferOwnership(daoOperations.address)
	// console.log("TokenFarm ownership transferred to DaoOperations: ", daoOperations.address)


	// // Add existing Pools & Indexes to DAOOperations & DAOTokenFarm
	// const poolAddresses = [pools.pool01v3a.pool, pools.pool02v3a.pool, pools.pool03v3a.pool, pools.pool04v3a.pool, pools.pool05v3a.pool, pools.pool06v3a.pool]
	// await daoOperations.addPools(poolAddresses)

	// const indexAddresses = [pools.index01v3a.pool, pools.index02v3a.pool, pools.index03v3a.pool]
	// await daoOperations.addIndexes(indexAddresses)

}



/// Helpers

const addPoolsAndIndexesToDaoOperations = async (daoOperationsAddr: string) => {

	const [ owner ] = await ethers.getSigners();
	const daoOperations = new Contract(daoOperationsAddr, abis['dao_operations'], ethers.provider)
	
	const poolsAddresses = getPoolsAddresses("pool")
	console.log(">>> adding poolsAddresses", poolsAddresses)
	await daoOperations.connect(owner).addPools(poolsAddresses)
	console.log(">>> added Pools to DaoOperations: ", await daoOperations.getEnabledPools())

	const indexesAddresses = getPoolsAddresses("index")
	console.log(">>> adding indexesAddresses", indexesAddresses)
	await daoOperations.connect(owner).addIndexes(indexesAddresses)
	console.log(">>> added Indexes to DaoOperations: ", await daoOperations.getEnabledIndexes())
}




const getPoolsAddresses = (keyPrefix: string): string[] => {
	
	return Object.keys(pools).filter( key => key.startsWith(keyPrefix) ).map(poolId => {
		const poolInfo = pools[poolId as keyof typeof pools]
		return poolInfo["pool"] as string
	});
}


/// ENTRY POINT

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});



// POOLS DATA

const pools = {

	"index01v3a": {
		"pool": "0xE61bA2eF1057dD90aAF9f021Fdf24F6B57D902AF",
		"pool_lp": "0x0560Dd521787e27126B93E98568002A3ef84E36c"
	},
	"index02v3a": {
		"pool": "0x1FB4fa664648a458c81A6fFDC7b3c7120CEb4E45",
		"pool_lp": "0x8A8dD5a0d50887D16303460ee00CB311D255b034"
	},
	"index03v3a": {
		"pool": "0xe0B5AfF7821bbABd48429D2B956A1202e3BA9b42",
		"pool_lp": "0x9D91628be9BA8B024644fF612d013956C7ADa928"
	},


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



