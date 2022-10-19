import { expect } from "chai";
import { constants, utils, Contract, BigNumber } from "ethers"
import { ethers, network } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { fromUsdc, toUsdc, round } from "./helpers"

import abis from "./abis/abis.json";

const usdcAddress = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
const usdcSource = '0xe7804c37c13166ff0b37f5ae0bb07a3aebb6e245' // rich account owing 48,354,222.149244  USDC

const poolOwner = '0x4F888d90c31c97efA63f0Db088578BB6F9D1970C'


describe("DAOOperations", function () {


	async function deployDAOOperationsFixture() {

		const Treasury = await ethers.getContractFactory("Treasury");
		const treasury = await Treasury.deploy(usdcAddress)
		await treasury.deployed()

		const HashStratDAOToken = await ethers.getContractFactory("HashStratDAOToken");
		const hashStratDAOToken = await HashStratDAOToken.deploy()
		await hashStratDAOToken.deployed()

		const DivsDistributor = await ethers.getContractFactory("DivsDistributor");
		const divsDistributor = await DivsDistributor.deploy(usdcAddress, hashStratDAOToken.address)
		await divsDistributor.deployed()

		const HashStratDAOTokenFarm = await ethers.getContractFactory("HashStratDAOTokenFarm")
		const hashStratDAOTokenFarm = await HashStratDAOTokenFarm.deploy(hashStratDAOToken.address)
		await hashStratDAOTokenFarm.deployed();

		// DAO Operations
		const DAOOperations = await ethers.getContractFactory("DAOOperations");
		const daoOperations = await DAOOperations.deploy(usdcAddress, treasury.address, divsDistributor.address, hashStratDAOTokenFarm.address)
		await daoOperations.deployed()
	
		// DAOOperations should own Treasury and hashStratDAOTokenFarm
		await treasury.transferOwnership(daoOperations.address)
		await hashStratDAOTokenFarm.transferOwnership(daoOperations.address)

		// Add existing Pools to DAOOperations 
		const poolAddresses = [pools.pool01v3a.pool, pools.pool02v3a.pool, pools.pool03v3a.pool, pools.pool04v3a.pool, pools.pool05v3a.pool, pools.pool06v3a.pool]
		await daoOperations.addPools(poolAddresses)

		const usdc = new Contract(usdcAddress, abis["erc20"], ethers.provider)

		await transferPoolsOwnership(poolAddresses, daoOperations.address)

		return { treasury, daoOperations, hashStratDAOTokenFarm, usdc };
	}



	describe("Pools Management", function () {

		it("should own its pools", async function () {
			const { daoOperations } = await loadFixture(deployDAOOperationsFixture);

			for (const poolAddress of await daoOperations.getPools()) {
				const pool = new Contract(poolAddress, abis["poolV3"], ethers.provider)
				// const poolOwner = await pool.owner()
				//console.log(poolAddress, ">> pool ownner: ", poolOwner, "daoOperations: ", daoOperations.address)

				expect ( await pool.owner() ).to.be.equals( daoOperations.address )
			}
		})

		it("should add pool when called by owner", async function () {
			const { daoOperations, hashStratDAOTokenFarm } = await loadFixture(deployDAOOperationsFixture);
			const [ owner ] = await ethers.getSigners();

			// add new pool
			const pool = '0x12a2aeFfc32e2e2151600693812738eDc7153B2A'
			await daoOperations.connect(owner).addPools([pool])
			const pools = await daoOperations.getEnabledPools()

			expect( pools ).to.contain(pool);

			const poolLP = '0x326A17829A9DCA987ae14448Dec7148552f05C22'
			expect( await hashStratDAOTokenFarm.getLPTokens() ).contains( poolLP )
		});

		it("should revert when add pool is called by non owner", async function () {
			const { daoOperations } = await loadFixture(deployDAOOperationsFixture);
			const pools = await daoOperations.getPools()
			const [ owner, other ] = await ethers.getSigners();

			// add new pool
			const pool = '0x12a2aeFfc32e2e2151600693812738eDc7153B2A'
			await expect( daoOperations.connect(other).addPools([pool]) ).to.be.revertedWith('Ownable: caller is not the owner');
		});
	});


	describe("#collectableFees", function () {

		it("should return the fees amount when there are LP in the pools", async function () {
			const { daoOperations } = await loadFixture(deployDAOOperationsFixture);

			const [ poolAddr ] = await daoOperations.getPools()
			const pool = new Contract(poolAddr, abis["poolV3"], ethers.provider)

			const poolTotalValue = await pool.totalValue()
			const lptoken = new Contract(pool.lpToken(), abis["erc20"], ethers.provider)

			// verify the Treasury received the expected fees
			const poolLPBalance = await lptoken.balanceOf(pool.address)
			expect( poolLPBalance ).to.be.greaterThan( 0 )

			const lpTotalSupply = await lptoken.totalSupply()
			const expectedFeesCollected = BigNumber.from(round( poolTotalValue * poolLPBalance / lpTotalSupply, 0))

			expect( fromUsdc(await daoOperations.collectableFees()) ).to.be.approximately( fromUsdc(expectedFeesCollected), 0.01 )
		});
	});


	describe("#collectFees", function () {

		it("should collect fees from pools and transfer the to Treasury", async function () {
			const { treasury, daoOperations, usdc } = await loadFixture(deployDAOOperationsFixture)

			const balanceBefore =  await usdc.balanceOf(treasury.address)
			await daoOperations.collectFees()

			const balanceAfter =  await usdc.balanceOf(treasury.address)

			expect( balanceAfter ).to.be.greaterThan( balanceBefore )
			
		});
	});


	describe("#transferFunds", function () {

		it("should transfer funds from the Treasury to the destination address", async function () {
			const { treasury, daoOperations, usdc } = await loadFixture(deployDAOOperationsFixture)

			const [ _, addr1, addr2 ] = await ethers.getSigners();

			await transferFunds( toUsdc('100').toString() , treasury.address)
			const balanceBefore =  await usdc.balanceOf(addr2.address)

			await daoOperations.transferFunds(addr2.address, toUsdc('100'))

			expect( (await usdc.balanceOf(addr2.address)).sub(balanceBefore) ).to.be.equal( toUsdc('100') )
			
		});
	});


	describe("#setOwnerships", function () {

		it("transfer ownerhsip of owned contracts when ownerhsip transfer is enabled", async function () {
			const { daoOperations } = await loadFixture(deployDAOOperationsFixture);
			const [ _, addr1 ] = await ethers.getSigners();

			// verity all pools are owned by DaoOperations
			const pools = await daoOperations.getEnabledPools()
			for (const poolAddress of pools) {
				const pool = new Contract(poolAddress, abis["poolV3"], ethers.provider)

				expect( await pool.owner() ).to.be.equal( daoOperations.address )
			}

			// transfer pools ownership to addr1
			await daoOperations.setOwnerships(pools, addr1.address)

			// verity new ownership
			for (const poolAddress of pools) {
				const pool = new Contract(poolAddress, abis["poolV3"], ethers.provider)

				expect( await pool.owner() ).to.be.equal( addr1.address )
			}
		})

		it("reverts with an error when ownerhsip transfer is disabled", async function () {
			const { daoOperations } = await loadFixture(deployDAOOperationsFixture);
			const [ _, addr1 ] = await ethers.getSigners();

			// verity all pools are owned by DaoOperations
			const pools = await daoOperations.getEnabledPools()

			// disable  ownership to addr1
			await daoOperations.disableOwnershipTransfers()

			await expect( daoOperations.setOwnerships(pools, addr1.address) ).to.be.revertedWith("DAOOperations: Ownership transfer is disabled");
		})
	});

	
});


async function transferPoolsOwnership(poolAddresses: string[], to: string) {

	// impersonate the owner of the Pools and transfer ownership to DAOOperations
	await network.provider.request({
		method: "hardhat_impersonateAccount",
		params: [poolOwner],
	});
	const signer = await ethers.getSigner(poolOwner);
	for (const poolAddress of poolAddresses) {
		const pool = new Contract(poolAddress, abis["poolV3"], ethers.provider)
		await pool.connect(signer).transferOwnership(to) 
	}
}

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

