import { expect } from "chai";
import { Contract, BigNumber } from "ethers"
import { ethers, network } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { fromUsdc, fromWei, waitDays, mineBlocks } from "./helpers"

import abis from "./abis/abis.json";


const usdcAddress = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
const usdcSource = '0xe7804c37c13166ff0b37f5ae0bb07a3aebb6e245' // rich account owing 48,354,222.149244  USDC


describe("HashStratDAOTokenFarm", function () {

	const max_supply = ethers.utils.parseEther('1000000.0');   // 1M tokens

	async function deployTokenAndFarm() {

		// Deploy HST token
		const HashStratDAOToken = await ethers.getContractFactory("HashStratDAOToken")
		const hashStratDAOToken = await HashStratDAOToken.deploy()
		await hashStratDAOToken.deployed()

		// Deploy Farm
		const HashStratDAOTokenFarm = await ethers.getContractFactory("HashStratDAOTokenFarm")
		const hashStratDAOTokenFarm = await HashStratDAOTokenFarm.deploy(hashStratDAOToken.address)
		await hashStratDAOTokenFarm.deployed();

		// Set farm address on DAO token
		await hashStratDAOToken.setFarmAddress(hashStratDAOTokenFarm.address)

		// add supported pools to Farm
		const poolsAddresses = getPoolsAddresses()
		await hashStratDAOTokenFarm.addPools(poolsAddresses)

		// add reward periods to Farm
		await hashStratDAOTokenFarm.addRewardPeriods()

		const usdc = new Contract(usdcAddress, abis["erc20"], ethers.provider)
		const pool1 = new Contract(pools.pool01v3.pool, abis["poolV3"], ethers.provider)
		const pool1LP = new Contract(pools.pool01v3.pool_lp, abis["erc20"], ethers.provider)

		return { hashStratDAOToken, hashStratDAOTokenFarm, usdc, pool1, pool1LP };
	}


	describe("Farm configuration", function () {

		it("Farm should have 9 LP tokens addresses", async function () {
			const { hashStratDAOTokenFarm } = await loadFixture(deployTokenAndFarm);

			expect((await hashStratDAOTokenFarm.getLPTokens()).length).to.equal(9);
		});


		it("Farm should have 10 distribution intervals", async function () {
			const { hashStratDAOTokenFarm } = await loadFixture(deployTokenAndFarm);

			expect(await hashStratDAOTokenFarm.rewardPeriodsCount()).to.equal(10);
		});

		it("The total amount of tokens distributed should be the token max supply", async function () {
			const { hashStratDAOTokenFarm, hashStratDAOToken } = await loadFixture(deployTokenAndFarm);

			const maxSupply = await hashStratDAOToken.MAX_SUPPLY()

			let totalReward = BigNumber.from(0)
			for (const period of await hashStratDAOTokenFarm.getRewardPeriods() ) {
				totalReward = totalReward.add(period.reward)
			}

			expect(totalReward).to.equal(maxSupply);
		});

	});


	describe("Token distribution", function () {

		it(`Given a user,
		when they stake some tokens for part of a reward period and no user has staked tokens before, 
		then they should farm all tokens issued for that part of the reward period`, async function () {

			const [addr1] = await ethers.getSigners();
			const { usdc, hashStratDAOTokenFarm, hashStratDAOToken, pool1, pool1LP } = await loadFixture(deployTokenAndFarm);
			const amount = 100 * 10 ** 6
			await transferFunds(amount, addr1.address)

			// Wait 180 days
			await waitDays(180)

			// Deposit USDC in pool and stake LP
			await depositAndStake(addr1, amount, usdc, pool1, pool1LP, hashStratDAOTokenFarm)
		
			// check LP tokens staked
			const lpstaked = await hashStratDAOTokenFarm.getStakedBalance(addr1.address, pool1LP.address)

			// Wait 2 days
			await waitDays(2)

			// claimable tokens
			const claimableRewardAddr1 = fromWei(await hashStratDAOTokenFarm.claimableReward(addr1.address))

			const expectedClaimabeTokens = 500_000 / 365 * 2  // tokens disributed for 2 days
			expect(claimableRewardAddr1).to.be.approximately(expectedClaimabeTokens, 1);

			await hashStratDAOTokenFarm.connect(addr1).endStakeAndWithdraw(pool1LP.address, lpstaked)
			const tokensFarmed = fromWei(await hashStratDAOToken.balanceOf(addr1.address))

			expect(tokensFarmed).to.be.approximately(expectedClaimabeTokens, 1);
		})


		it(`Given a user,
		when they stake some tokens for the entire reward period, 
		then they should farm all tokens in that period`, async function () {

			const [addr1] = await ethers.getSigners();
			const { usdc, hashStratDAOTokenFarm, hashStratDAOToken, pool1, pool1LP } = await loadFixture(deployTokenAndFarm);
			const amount = 100 * 10 ** 6
			await transferFunds(amount, addr1.address)

			// Deposit USDC in pool and stake LP
			const lpstaked = await depositAndStake(addr1, amount, usdc, pool1, pool1LP, hashStratDAOTokenFarm)

			expect(lpstaked).to.be.equal(await hashStratDAOTokenFarm.getStakedBalance(addr1.address, pool1LP.address))

			// Wait 1 year
			await waitDays(365)

			// claimable tokens after 1 year
			const claimableRewardAddr1 = fromWei(await hashStratDAOTokenFarm.claimableReward(addr1.address))
			expect(claimableRewardAddr1).to.be.approximately(500_000, 1);

			await hashStratDAOTokenFarm.connect(addr1).endStakeAndWithdraw(pool1LP.address, lpstaked)
			const tokensFarmed = fromWei(await hashStratDAOToken.balanceOf(addr1.address))

			expect(tokensFarmed).to.be.approximately(500_000, 1);
		})


		it(`Given a user,
		when they stake some tokens for all reward periods, 
		then they should farm the token max supply`, async function () {

			const [addr1] = await ethers.getSigners();
			const { usdc, hashStratDAOTokenFarm, hashStratDAOToken, pool1, pool1LP } = await loadFixture(deployTokenAndFarm);
			const amount = 100 * 10 ** 6
			await transferFunds(amount, addr1.address)

			// Deposit USDC in pool and stake LP
			const lpstaked = await depositAndStake(addr1, amount, usdc, pool1, pool1LP, hashStratDAOTokenFarm)

			expect(lpstaked).to.be.equal(await hashStratDAOTokenFarm.getStakedBalance(addr1.address, pool1LP.address))

			// Wait 10 years
			await waitDays(10 * 365)

			// claimable tokens after 1 year
			const claimableRewardAddr1 = fromWei(await hashStratDAOTokenFarm.claimableReward(addr1.address))
			expect(claimableRewardAddr1).to.be.approximately(1_000_000, 20);

			await hashStratDAOTokenFarm.connect(addr1).endStakeAndWithdraw(pool1LP.address, lpstaked)
			const tokensFarmed = fromWei(await hashStratDAOToken.balanceOf(addr1.address))

			expect(tokensFarmed).to.be.approximately(1_000_000, 20);
		})


		it(`Given a user,
		when they farm some tokens and they are not set as delegate,
		then they should become the delegate of the tokens' votes`, async function () {

			const [addr1] = await ethers.getSigners();
			const { usdc, hashStratDAOTokenFarm, hashStratDAOToken, pool1, pool1LP } = await loadFixture(deployTokenAndFarm);
			const amount = 100 * 10 ** 6
			await transferFunds(amount, addr1.address)

			// Deposit USDC in pool and stake LP
			const lpstaked = await depositAndStake(addr1, amount, usdc, pool1, pool1LP, hashStratDAOTokenFarm)

			expect(lpstaked).to.be.equal(await hashStratDAOTokenFarm.getStakedBalance(addr1.address, pool1LP.address))

			// Wait 30 days
			await waitDays(30)

			// claimable tokens after 1 year
			const claimableRewardAddr1 = fromWei(await hashStratDAOTokenFarm.claimableReward(addr1.address))
			expect(claimableRewardAddr1).to.be.approximately(500_000 * 30 / 365, 1);

			// no tokens farmed & no delegate
			expect( await hashStratDAOToken.balanceOf(addr1.address) ).to.be.equal(0);
			expect( await hashStratDAOToken.delegates(addr1.address) ).to.be.equal( ethers.constants.AddressZero );

			// addr1 end stake and receive some tokens
			await hashStratDAOTokenFarm.connect(addr1).endStake(pool1LP.address, lpstaked)

			// verify tokens were received by addr1 and he is the delegate
			expect( await hashStratDAOToken.balanceOf(addr1.address) ).to.be.greaterThan( 0 )
			expect( await hashStratDAOToken.delegates(addr1.address) ).to.be.equal( addr1.address );
		})


		it(`Given Two users,
		when they stake the same amount for the entire reward period, 
		then they should receive half of the available reward in the period`, async function () {

			const [addr1, addr2] = await ethers.getSigners();
			const { usdc, hashStratDAOTokenFarm, hashStratDAOToken, pool1, pool1LP } = await loadFixture(deployTokenAndFarm);

			const amount = 100 * 10 ** 6
			await transferFunds(amount, addr1.address)
			await transferFunds(amount, addr2.address)

			// addr1, addr2 deposit and stake the same amount of USDC
			const lpstaked1 = await depositAndStake(addr1, amount, usdc, pool1, pool1LP, hashStratDAOTokenFarm)
			const lpstaked2 = await depositAndStake(addr2, amount, usdc, pool1, pool1LP, hashStratDAOTokenFarm)

			// Wait 12 month
			await waitDays(365)

			// claimable tokens after 12 month2
			const claimableRewardAddr1 = fromWei(await hashStratDAOTokenFarm.claimableReward(addr1.address))
			const claimableRewardAddr2 = fromWei(await hashStratDAOTokenFarm.claimableReward(addr2.address))

			expect(claimableRewardAddr1).to.be.approximately(250_000, 20);
			expect(claimableRewardAddr2).to.be.approximately(250_000, 20);

			// addr1, addr2 end stake
			await hashStratDAOTokenFarm.connect(addr1).endStakeAndWithdraw(pool1LP.address, lpstaked1)
			await hashStratDAOTokenFarm.connect(addr2).endStakeAndWithdraw(pool1LP.address, lpstaked2)

			const tokensFarmed1 = fromWei(await hashStratDAOToken.balanceOf(addr1.address))
			const tokensFarmed2 = fromWei(await hashStratDAOToken.balanceOf(addr2.address))

			// users should have farmed approximately the same amount of tokens
			expect(tokensFarmed1).to.be.approximately(tokensFarmed2, 40);

			// users should have farmed approximately half od the available tokens
			expect(tokensFarmed1).to.be.approximately(250_000, 15);
			expect(tokensFarmed2).to.be.approximately(250_000, 15);

		});


		it(`Given Two users, 
		when they stake some amount for half of the reward period, 
		then they should receive half of the available reward in the period`, async function () {

			const [addr1, addr2] = await ethers.getSigners();
			const { usdc, hashStratDAOTokenFarm, hashStratDAOToken, pool1, pool1LP } = await loadFixture(deployTokenAndFarm);

			const amount1 = 100 * 10 ** 6
			const amount2 = 50 * 10 ** 6
			await transferFunds(amount1, addr1.address)
			await transferFunds(amount2, addr2.address)

			// addr1 deposit and stake
			const lpstaked1 = await depositAndStake(addr1, amount1, usdc, pool1, pool1LP, hashStratDAOTokenFarm)

			// Wait 6 months
			await waitDays(365 / 2)

			// addr1 claimable tokens after 6 months stake
			const claimableRewardAddr1 = fromWei(await hashStratDAOTokenFarm.claimableReward(addr1.address))
			expect(claimableRewardAddr1).to.be.approximately(250_000, 2);

			// addr1 end stake and withdraw
			await hashStratDAOTokenFarm.connect(addr1).endStakeAndWithdraw(pool1LP.address, lpstaked1)

			//FIXME wait extra day
			await mineBlocks(1) // wait for the end of the proposal period

			// addr2 deposit and stake
			await depositAndStake(addr2, amount2, usdc, pool1, pool1LP, hashStratDAOTokenFarm)

			// Wait other 6 months
			await waitDays(365 / 2)

			// addr2 claimable tokens after 6 months stake
			const claimableRewardAddr2 = fromWei(await hashStratDAOTokenFarm.claimableReward(addr2.address))

			expect(claimableRewardAddr2).to.be.approximately(250_000, 2);  // 375019.0451333446

			// addr2 end stake and withdraw
			const lpstaked2 = hashStratDAOTokenFarm.getStakedBalance(addr2.address, pool1LP.address)
			await hashStratDAOTokenFarm.connect(addr2).endStakeAndWithdraw(pool1LP.address, lpstaked2)

			// verify amount of tokens farmed
			const tokensFarmed1 = fromWei(await hashStratDAOToken.balanceOf(addr1.address))
			const tokensFarmed2 = fromWei(await hashStratDAOToken.balanceOf(addr2.address))

			// users should have farmed approximately the same amount of tokens
			expect(tokensFarmed1).to.be.approximately(tokensFarmed2, 5);

			// users should have farmed approximately half od the available tokens
			expect(tokensFarmed1).to.be.approximately(250_000, 2);
			expect(tokensFarmed2).to.be.approximately(250_000, 2);

		});


		it(`Given Two users, 
		when they stake some LP tokens for different, overlapping intervals over the same reward period, 
		then they should receive a reward that is proportional to the amount of tokens staked and the duration of their stakes`, async function () {

			const [addr1, addr2] = await ethers.getSigners();
			const { usdc, hashStratDAOTokenFarm, hashStratDAOToken, pool1, pool1LP } = await loadFixture(deployTokenAndFarm);

			const amount1 = 100 * 10 ** 6
			const amount2 = 50 * 10 ** 6
			await transferFunds(amount1, addr1.address)
			await transferFunds(amount2, addr2.address)

			// addr1 deposit and stake
			const lpstaked1 = await depositAndStake(addr1, amount1, usdc, pool1, pool1LP, hashStratDAOTokenFarm)

			// Wait 3 months
			await waitDays(365 * 1 / 4)

			// addr1 claimable tokens after 3 months stake shoud be 1/4 of the overall reward for the year
			const claimableRewardAddr1 = fromWei(await hashStratDAOTokenFarm.claimableReward(addr1.address))
			expect(claimableRewardAddr1).to.be.approximately(500_000 / 4, 2);

			// addr2 deposit and stake
			const lpstaked2 = await depositAndStake(addr2, amount2, usdc, pool1, pool1LP, hashStratDAOTokenFarm)

			// Wait other 9 months
			await waitDays(365 * 3 / 4)

			// addr1, addr2 end stake and withdraw
			await hashStratDAOTokenFarm.connect(addr1).endStakeAndWithdraw(pool1LP.address, lpstaked1)
			await hashStratDAOTokenFarm.connect(addr2).endStakeAndWithdraw(pool1LP.address, lpstaked2)


			// verify amount of tokens farmed
			const tokensFarmed1 = fromWei(await hashStratDAOToken.balanceOf(addr1.address))
			const tokensFarmed2 = fromWei(await hashStratDAOToken.balanceOf(addr2.address))

			// users should have farmed an aout of token proportional to the amount and period of their stakes
			const expectedFarmed1 = (500_000 * 1 / 4) + (500_000 * 3 / 4 * 2 / 3)
			const expectedFarmed2 = 0 + (500_000 * 3 / 4 * 1 / 3)


			// users should have farmed approximately half od the available tokens
			expect(tokensFarmed1).to.be.approximately(expectedFarmed1, 20);
			expect(tokensFarmed2).to.be.approximately(expectedFarmed2, 20);

		});


		it(`Given Two users,
		when they stake some LP tokens for different, overlapping intervals over multiple reward periods,
		then they should receive a reward that is proportional to the amount of tokens staked and the duration of their stakes`, async function () {

			const [addr1, addr2] = await ethers.getSigners();
			const { usdc, hashStratDAOTokenFarm, hashStratDAOToken, pool1, pool1LP } = await loadFixture(deployTokenAndFarm);

			const amount1 = 100 * 10 ** 6
			const amount2 = 50 * 10 ** 6
			await transferFunds(amount1, addr1.address)
			await transferFunds(amount2, addr2.address)

			// Wait 3 months
			await waitDays(365 * 1 / 4)

			// addr1 deposit and stake
			const lpstaked1 = await depositAndStake(addr1, amount1, usdc, pool1, pool1LP, hashStratDAOTokenFarm)

			// Wait 1y and 3m (to 1y and 6m)
			await waitDays(365 + 365 / 4)

			// addr1 claimable tokens after 1y and 3m staking should be 3/4 of the reward for year 1 and 1/2 of the reward for year 2
			const claimableRewardAddr1 = fromWei(await hashStratDAOTokenFarm.claimableReward(addr1.address))
			expect(claimableRewardAddr1).to.be.approximately(500_000 * 3 / 4 + 250_000 / 2, 2);

			// addr2 deposit and stake (after 1y and 6m)
			const lpstaked2 = await depositAndStake(addr2, amount2, usdc, pool1, pool1LP, hashStratDAOTokenFarm)

			// Wait 9 months (to 2y and 3m)
			await waitDays(365 * 3 / 4)

			// addr1, addr2 end stake and withdraw
			await hashStratDAOTokenFarm.connect(addr1).endStakeAndWithdraw(pool1LP.address, lpstaked1)

			// Wait 9 months (to end of 3y)
			await waitDays(365 * 3 / 4)
			await hashStratDAOTokenFarm.connect(addr2).endStakeAndWithdraw(pool1LP.address, lpstaked2)

			// get the amount of tokens farmed
			const tokensFarmed1 = fromWei(await hashStratDAOToken.balanceOf(addr1.address))
			const tokensFarmed2 = fromWei(await hashStratDAOToken.balanceOf(addr2.address))

			// addr1,addr2 should have farmed an amount of token proportional to the amount and period of their stakes
			const expectedFarmed1 = (500_000 * 3 / 4) + (250_000 * 1 / 2) + (250_000 * 1 / 2 * 2 / 3) + (125_000 * 1 / 4 * 2 / 3)
			const expectedFarmed2 = 0 + 0 + (250_000 * 1 / 2 * 1 / 3) + (125_000 * 1 / 4 * 1 / 3) + (125_000 * 3 / 4)


			// users should have farmed approximately half od the available tokens
			expect(tokensFarmed1).to.be.approximately(expectedFarmed1, 15);
			expect(tokensFarmed2).to.be.approximately(expectedFarmed2, 15);

		});


		it(`Given Two users,
		when they stake some LP tokens for different, non overlapping intervals over different reward periods,
		then they should receive a reward that is proportional the duration of their stakes`, async function () {

			const [addr1, addr2] = await ethers.getSigners();
			const { usdc, hashStratDAOTokenFarm, hashStratDAOToken, pool1, pool1LP } = await loadFixture(deployTokenAndFarm);

			const amount1 = 100 * 10 ** 6
			const amount2 = 50 * 10 ** 6
			await transferFunds(2 * amount1, addr1.address)
			await transferFunds(2 * amount2, addr2.address)

			// Wait 3 months (to 1y 3m)
			await waitDays(365 * 1 / 4)

			// addr1 deposit and stake for 6m (to 1y 9m)
			const lpstaked1 = await depositAndStake(addr1, amount1, usdc, pool1, pool1LP, hashStratDAOTokenFarm)
			await waitDays(365 / 2)
			await endStakeAndWithdraw(addr1, lpstaked1, pool1, pool1LP, hashStratDAOTokenFarm)

			// Wait 3 months (to 2y 0m)
			await waitDays(365 * 1 / 4)

			// addr2 deposit and stake for 9m (to 2y 9m)
			const lpstaked2 = await depositAndStake(addr2, amount2, usdc, pool1, pool1LP, hashStratDAOTokenFarm)
			await waitDays(365 * 3 / 4)
			await endStakeAndWithdraw(addr2, lpstaked2, pool1, pool1LP, hashStratDAOTokenFarm)

			// Wait 3 months (to 3y 0m)
			await waitDays(365 * 1 / 4)

			// addr2 stakes for 3 months (to 3y 3m)
			await depositAndStake(addr2, amount2, usdc, pool1, pool1LP, hashStratDAOTokenFarm)
			await waitDays(365 * 1 / 4)
			await endStakeAndWithdraw(addr2, lpstaked2, pool1, pool1LP, hashStratDAOTokenFarm)

			// Wait 3 months (to 3y 6m)
			await waitDays(365 * 1 / 4)

			// addr1 stakes for 6m (to end of 3y)
			await depositAndStake(addr1, amount1, usdc, pool1, pool1LP, hashStratDAOTokenFarm)
			await waitDays(365 / 2)
			await endStakeAndWithdraw(addr1, lpstaked1, pool1, pool1LP, hashStratDAOTokenFarm)


			// get the amount of tokens farmed
			const tokensFarmed1 = fromWei(await hashStratDAOToken.balanceOf(addr1.address))
			const tokensFarmed2 = fromWei(await hashStratDAOToken.balanceOf(addr2.address))

			// addr1,addr2 should have farmed an amount of token proportional to the amount and period of their stakes
			const expectedFarmed1 = (500_000 * 1 / 2) + 0 + (125_000 * 1 / 2)
			const expectedFarmed2 = 0 + (250_000 * 3 / 4) + (125_000 * 1 / 4)


			// users should have farmed approximately half od the available tokens
			expect(tokensFarmed1).to.be.approximately(expectedFarmed1, 150);
			expect(tokensFarmed2).to.be.approximately(expectedFarmed2, 150);
		});

	});


	it(`Given two users,
	when one of them partially unstake their tokens, 
	then he accrues rewards only for the value remaining staked`, async function () {

		const [addr1, addr2] = await ethers.getSigners();
		const { usdc, hashStratDAOTokenFarm, hashStratDAOToken, pool1, pool1LP } = await loadFixture(deployTokenAndFarm);
		const amount1 = 200 * 10 ** 6
		const amount2 = 100 * 10 ** 6

		await transferFunds(amount1, addr1.address)
		await transferFunds(amount2, addr2.address)

		// Deposit USDC in pool and stake LP
		const lpstaked1 = await depositAndStake(addr1, amount1, usdc, pool1, pool1LP, hashStratDAOTokenFarm)
		const lpstaked2 = await depositAndStake(addr2, amount2, usdc, pool1, pool1LP, hashStratDAOTokenFarm)

		// Wait 30 days
		await waitDays(30)

		// claimable tokens after 30 days
		const expectedReward1 = 500_000 * 30/365 * 2/3
		const expectedReward2 = 500_000 * 30/365 * 1/3

		const claimableRewardAddr1 = fromWei(await hashStratDAOTokenFarm.connect(addr1).claimableReward(addr1.address))
		expect(claimableRewardAddr1).to.be.approximately(expectedReward1, 10);

		const claimableRewardAddr2 = fromWei(await hashStratDAOTokenFarm.connect(addr2).claimableReward(addr2.address))
		expect(claimableRewardAddr2).to.be.approximately(expectedReward2, 10);

		// addr1 unstakes half of the 
		const unstakeAmount1 = lpstaked1 / 2
		await hashStratDAOTokenFarm.connect(addr1).endStakeAndWithdraw(pool1LP.address, unstakeAmount1)
		const tokensFarmed1 = fromWei(await hashStratDAOToken.balanceOf(addr1.address))

		expect(tokensFarmed1).to.be.approximately(expectedReward1, 10);

		// wait 30 days more
		await waitDays(30)

		const expectedReward1a = 500_000 * 30/365 * 2/3 + 500_000 * 30/365 * 1/2
		const expectedReward2a = 500_000 * 30/365 * 1/3 + 500_000 * 30/365 * 1/2

		await hashStratDAOTokenFarm.connect(addr1).endStakeAndWithdraw(pool1LP.address, unstakeAmount1)
		const tokensFarmed1a = fromWei(await hashStratDAOToken.balanceOf(addr1.address))
		
		await hashStratDAOTokenFarm.connect(addr2).endStakeAndWithdraw(pool1LP.address, lpstaked2)
		const tokensFarmed2a = fromWei(await hashStratDAOToken.balanceOf(addr2.address))

		expect(tokensFarmed1a).to.be.approximately(expectedReward1a, 10);
		expect(tokensFarmed2a).to.be.approximately(expectedReward2a, 10);
	
	})


	it(`Given Three users,
		when they stake some LP tokens for different, overlapping intervals beyond all reward periods,
		then the reward received will not exceed the token max supply`, async function () {

			const [addr1, addr2, addr3] = await ethers.getSigners();
			const { usdc, hashStratDAOTokenFarm, hashStratDAOToken, pool1, pool1LP } = await loadFixture(deployTokenAndFarm);

			const amount1 = 500 * 10 ** 6
			const amount2 = 300 * 10 ** 6
			const amount3 = 200 * 10 ** 6
			await transferFunds(amount1, addr1.address)
			await transferFunds(amount2, addr2.address)
			await transferFunds(amount3, addr3.address)

			// // Wait 1y
			await waitDays(365)

			const lpstaked1 = await depositAndStake(addr1, amount1, usdc, pool1, pool1LP, hashStratDAOTokenFarm)
			const lpstaked2 = await depositAndStake(addr2, amount2, usdc, pool1, pool1LP, hashStratDAOTokenFarm)
			const lpstaked3 = await depositAndStake(addr3, amount3, usdc, pool1, pool1LP, hashStratDAOTokenFarm)

			// Wait 20 (double the duration of the token distribution)
			await waitDays(20 * 365)

			const claimableRewardAddr1 = fromWei(await hashStratDAOTokenFarm.claimableReward(addr1.address))
			const claimableRewardAddr2 = fromWei(await hashStratDAOTokenFarm.claimableReward(addr2.address))
			const claimableRewardAddr3 = fromWei(await hashStratDAOTokenFarm.claimableReward(addr3.address))

			const expectedFarmed1 = 1_000_000 * 5 / 10 / 2
			const expectedFarmed2 = 1_000_000 * 3 / 10 / 2
			const expectedFarmed3 = 1_000_000 * 2 / 10 / 2

			expect(claimableRewardAddr1).to.be.approximately(expectedFarmed1, 100);
			expect(claimableRewardAddr2).to.be.approximately(expectedFarmed2, 100);
			expect(claimableRewardAddr3).to.be.approximately(expectedFarmed3, 100);
		
			// addr1, addr2, addr3 end stake and withdraw
			await hashStratDAOTokenFarm.connect(addr1).endStakeAndWithdraw(pool1LP.address, lpstaked1)
			await hashStratDAOTokenFarm.connect(addr2).endStakeAndWithdraw(pool1LP.address, lpstaked2)
			await hashStratDAOTokenFarm.connect(addr3).endStakeAndWithdraw(pool1LP.address, lpstaked3)

			// get the amount of tokens farmed
			const tokensFarmed1 = fromWei(await hashStratDAOToken.balanceOf(addr1.address))
			const tokensFarmed2 = fromWei(await hashStratDAOToken.balanceOf(addr2.address))
			const tokensFarmed3 = fromWei(await hashStratDAOToken.balanceOf(addr3.address))

			// users should have farmed the expected tokens
			expect(tokensFarmed1).to.be.approximately(expectedFarmed1, 100);
			expect(tokensFarmed2).to.be.approximately(expectedFarmed2, 100);
			expect(tokensFarmed3).to.be.approximately(expectedFarmed3, 100);

		});

});


async function depositAndStake(addr: SignerWithAddress, amount: number, usdc: Contract, pool: Contract, poolLP: Contract, hashStratDAOTokenFarm: Contract) {
	
	const lpbalanceBefore = await poolLP.balanceOf(addr.address)

	await usdc.connect(addr).approve(pool.address, amount)
	await pool.connect(addr).deposit(amount)

	// Stake LP 
	const lpbalance = await poolLP.balanceOf(addr.address)
	const diff = lpbalance.sub(lpbalanceBefore)

	await poolLP.connect(addr).approve(hashStratDAOTokenFarm.address, diff)
	await hashStratDAOTokenFarm.connect(addr).depositAndStartStake(poolLP.address, lpbalance)

	return lpbalance
}


async function endStakeAndWithdraw(addr: SignerWithAddress, amount: number, pool: Contract, poolLP: Contract, hashStratDAOTokenFarm: Contract) {

	// end stake and get back farmed tokens and LP tokens 
	await hashStratDAOTokenFarm.connect(addr).endStakeAndWithdraw(poolLP.address, amount)
	await pool.connect(addr).withdrawAll()
}


async function transferFunds(amount: number, recipient: string) {

	// 48,354,222.149244   100.000000
	const [owner, addr1, addr2] = await ethers.getSigners();
	const usdc = new Contract(usdcAddress, abis["erc20"], ethers.provider)

	// impersonate 'account'
	await network.provider.request({
		method: "hardhat_impersonateAccount",
		params: [usdcSource],
	});
	const signer = await ethers.getSigner(usdcSource);
	await usdc.connect(signer).transfer(recipient, amount)
}




const getPoolsAddresses = (): string[] => {
	return Object.keys(pools).map(poolId => {
		const poolInfo = pools[poolId as keyof typeof pools]
		return poolInfo["pool"] as string
	});
}



// Polygon Pools
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


	"pool01v3": {
		"pool": "0xb7BB83e1c826a8945652434DCf1758B46d6A5120",
		"pool_lp": "0xF87c6838EAD55f40B7d3038FBbb1287767898EeB",
		"strategy": "0x6aa3D1CB02a20cff58B402852FD5e8666f9AD4bd",
		"price_feed": "0xc907E116054Ad103354f2D350FD2514433D57F6f"
	},
	"pool02v3": {
		"pool": "0x12a2aeFfc32e2e2151600693812738eDc7153B2A",
		"pool_lp": "0x326A17829A9DCA987ae14448Dec7148552f05C22",
		"strategy": "0xca5B24b63D929Ddd5856866BdCec17cf13bDB359",
		"price_feed": "0xF9680D99D6C9589e2a93a78A04A279e509205945"
	},
	"pool03v3": {
		"pool": "0xdE2965dFE6a87fD303E252f44678A7580b4580Da",
		"pool_lp": "0x1cdD5238d95d06b252dfF2F5b27566f2103291B0",
		"strategy": "0x46cfDDc7ab8348b44b4a0447F0e5077188c4ff14",
		"price_feed": "0xc907E116054Ad103354f2D350FD2514433D57F6f"
	},
	"pool04v3": {
		"pool": "0x45E850A7E3ba7f67196EC1e19aFBEe1Ed0f3E875",
		"pool_lp": "0x1d8F6DaA2e438BAB778E47f2B5d4aa4C545e0822",
		"strategy": "0x02CF4916Dd9f4bB329AbE5e043569E586fE006E4",
		"price_feed": "0xF9680D99D6C9589e2a93a78A04A279e509205945"
	},
	"pool05v3": {
		"pool": "0xdB1fc68059ca310E51F5Ba6BdD567b08858eb29D",
		"pool_lp": "0xD95Bd1BD362298624471C15bb959A9E4e883F670",
		"strategy": "0x7F7a40fa461931f3aecD183f8B56b2782483B04B",
		"price_feed": "0xc907E116054Ad103354f2D350FD2514433D57F6f"
	},
	"pool06v3": {
		"pool": "0x32B4A2F744Ab50e80ffa3E48CF4Caaadd37d7215",
		"pool_lp": "0xEE41Db28d1224807358e11155bA7Df9d9cEC90F2",
		"strategy": "0x26311040c72f08EF1440B784117eb96EA20A2412",
		"price_feed": "0xF9680D99D6C9589e2a93a78A04A279e509205945"
	},
}
