import { expect } from "chai";
import { constants, utils, Contract } from "ethers"
import { ethers, network } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { fromUsdc, toUsdc, mineBlocks, toWei } from "./helpers"

import abis from "./abis/abis.json";

const usdcAddress = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
const usdcSource = '0xe7804c37c13166ff0b37f5ae0bb07a3aebb6e245' // rich USDC account


describe("DivsDistributor", function () {


	async function deployDivsDistributorFixture() {

		const [ owner, addr1, addr2, other ] = await ethers.getSigners();

		const Treasury = await ethers.getContractFactory("Treasury");
		const treasury = await Treasury.deploy(usdcAddress)
		await treasury.deployed()

		const HashStratDAOToken = await ethers.getContractFactory("HashStratDAOToken");
		const hashStratDAOToken = await HashStratDAOToken.deploy()
		await hashStratDAOToken.deployed()

		await hashStratDAOToken.setFarmAddress(owner.address)

		// address feesTokenAddress, address hstTokenAddress
		const DivsDistributor = await ethers.getContractFactory("DivsDistributor");
		const divsDistributor = await DivsDistributor.deploy(usdcAddress, hashStratDAOToken.address)
		await divsDistributor.deployed()

		const usdc = new Contract(usdcAddress, abis["erc20"], ethers.provider)

		// addr1, addr2, empthy their usdc balance
		await usdc.connect(addr1).transfer(other.address, await usdc.balanceOf(addr1.address))
		await usdc.connect(addr2).transfer(other.address, await usdc.balanceOf(addr2.address))

		return { treasury, divsDistributor, hashStratDAOToken, usdc };
	}

	describe("#addDistributionInterval", function () {

		it("creates the first distribution interval", async function () {
			const { divsDistributor, usdc } = await loadFixture(deployDivsDistributorFixture);

			// transfer some funds to divs distributor
			const amount = toUsdc('200').toString()
			await transferFunds(amount, divsDistributor.address)

			expect( fromUsdc(await usdc.balanceOf(divsDistributor.address)) ).to.be.equal( 200 )

			await divsDistributor.addDistributionInterval()
			await mineBlocks(1)

			expect( await divsDistributor.getDistributionIntervalsCount() ).to.be.equal( 1 )

			const firstInterval = await divsDistributor.distributionIntervals(0)

			expect( await divsDistributor.getDistributionIntervalsCount() ).to.be.equal( 1 )
			expect( firstInterval.reward ).to.be.equal( toUsdc('200') )
			expect( firstInterval.to.sub(firstInterval.from) ).to.be.equal(  await divsDistributor.paymentInterval() )
		})


		it("creates a new distribution interval when the previous distribution ended", async function () {
			const { divsDistributor, usdc } = await loadFixture(deployDivsDistributorFixture);
	
			// transfer some funds to divs distributor
			const amount = toUsdc('200').toString()
			await transferFunds(amount, divsDistributor.address)

			expect( fromUsdc(await usdc.balanceOf(divsDistributor.address)) ).to.be.equal( 200 )

			// create a fist distribution interval
			await divsDistributor.addDistributionInterval()

			// wait for this payment interval to expire
			await mineBlocks( (await divsDistributor.paymentInterval()).toNumber() + 1)

			expect ( await divsDistributor.canCreateNewDistributionInterval() ).to.be.true

			// create another distribution interval
			await divsDistributor.addDistributionInterval()
			expect( await divsDistributor.getDistributionIntervalsCount() ).to.be.equal( 2 )
		})


		it("cannot create a new distribution interval when there are no funds to distribute", async function () {
			const { divsDistributor, usdc } = await loadFixture(deployDivsDistributorFixture);

			expect( fromUsdc(await usdc.balanceOf(divsDistributor.address)) ).to.be.equal( 0 )

			// fail to create another distribution interval
			await expect( divsDistributor.addDistributionInterval() ).to.be.revertedWith("Cannot create distribution interval");

			expect( await divsDistributor.getDistributionIntervalsCount() ).to.be.equal( 0 )
		})

		it("cannot create a new distribution interval when the previous distribution has not ended", async function () {
			const { divsDistributor, usdc } = await loadFixture(deployDivsDistributorFixture);

			// transfer some funds to divs distributor
			const amount = toUsdc('200').toString()
			await transferFunds(amount, divsDistributor.address)
			
			expect( fromUsdc(await usdc.balanceOf(divsDistributor.address)) ).to.be.equal( 200 )

			// create a fist distribution interval
			await divsDistributor.addDistributionInterval()

			// wait until the last block of the distribution interval
			await mineBlocks( (await divsDistributor.paymentInterval()).toNumber() - 1)

			expect ( await divsDistributor.canCreateNewDistributionInterval() ).to.be.false

			// fail to create another distribution interval
			await expect( divsDistributor.addDistributionInterval() ).to.be.revertedWith("Cannot create distribution interval");
			expect( await divsDistributor.getDistributionIntervalsCount() ).to.be.equal( 1 )
		})


	});


	describe("#claimableDivs", function () {

		it("returns the amount of dividends when a user has DAO tokens at the start of the distribution period", async function () {
			const { hashStratDAOToken, divsDistributor, usdc } = await loadFixture(deployDivsDistributorFixture);
			const [ addr1, addr2 ] = await ethers.getSigners();

			// mint tokens to accounts
			await hashStratDAOToken.mint( addr1.address, toWei('10'))
			await hashStratDAOToken.mint( addr2.address, toWei('30'))
			await hashStratDAOToken.connect(addr1).autoDelegate()
			await hashStratDAOToken.connect(addr2).autoDelegate()

			// transfer some funds to divs distributor
			const amount = toUsdc('200').toString()
			await transferFunds(amount, divsDistributor.address)

			expect( fromUsdc(await usdc.balanceOf(divsDistributor.address)) ).to.be.equal( 200 )

			await divsDistributor.addDistributionInterval()
			await mineBlocks(1)

			expect( await divsDistributor.getDistributionIntervalsCount() ).to.be.equal( 1 )
			expect( fromUsdc(await divsDistributor.claimableDivs(addr1.address)) ).to.be.equal( 50 )
		})


		it("returns no dividends when a user has no tokens at the start of the distribution period", async function () {
			const { divsDistributor, hashStratDAOToken } = await loadFixture(deployDivsDistributorFixture);
			const [ owner, addr1, addr2 ] = await ethers.getSigners();

			const amount = toUsdc('200').toString()
			await transferFunds(amount, divsDistributor.address)

			await divsDistributor.addDistributionInterval()
			await mineBlocks(1)

			// mint tokens to accounts
			await hashStratDAOToken.mint( addr1.address, toWei('10'))
			await hashStratDAOToken.mint( addr2.address, toWei('30'))
			await hashStratDAOToken.connect(addr1).autoDelegate()
			await hashStratDAOToken.connect(addr2).autoDelegate()
			
			await mineBlocks(1)

			expect ( await divsDistributor.claimableDivs(addr1.address) ).to.be.equals( 0 )
		})


		it("returns no dividends when a user did already claim", async function () {
			const { hashStratDAOToken, divsDistributor, usdc } = await loadFixture(deployDivsDistributorFixture);
			const [ addr1, addr2 ] = await ethers.getSigners();

			// mint tokens to accounts
			await hashStratDAOToken.mint( addr1.address, toWei('10'))
			await hashStratDAOToken.mint( addr2.address, toWei('30'))
			await hashStratDAOToken.connect(addr1).autoDelegate()
			await hashStratDAOToken.connect(addr2).autoDelegate()

			// transfer some funds to divs distributor
			const amount = toUsdc('200').toString()
			await transferFunds(amount, divsDistributor.address)

			expect( fromUsdc(await usdc.balanceOf(divsDistributor.address)) ).to.be.equal( 200 )

			await divsDistributor.addDistributionInterval()
			await mineBlocks(1)
			
			await divsDistributor.connect(addr1).claimDivs()

			expect ( await divsDistributor.claimableDivs(addr1.address) ).to.be.equals( 0 )

		});



		it("returns no dividends when a user tranfers all tokens before a new distribution period starts", async function () {
			const { hashStratDAOToken, divsDistributor, usdc } = await loadFixture(deployDivsDistributorFixture);
			const [ owner, addr1, addr2 ] = await ethers.getSigners();

			// mint tokens to accounts
			await hashStratDAOToken.mint( addr1.address, toWei('10'))
			await hashStratDAOToken.mint( addr2.address, toWei('30'))
			await hashStratDAOToken.connect(addr1).autoDelegate()
			await hashStratDAOToken.connect(addr2).autoDelegate()

			// transfer some funds to divs distributor
			const amount = toUsdc('200').toString()
			await transferFunds(amount, divsDistributor.address)

			expect( fromUsdc(await usdc.balanceOf(divsDistributor.address)) ).to.be.equal( 200 )

			await divsDistributor.addDistributionInterval()
			await mineBlocks(1)

			expect( await divsDistributor.getDistributionIntervalsCount() ).to.be.equal( 1 )
			expect( fromUsdc(await divsDistributor.claimableDivs(addr1.address)) ).to.be.equal( 50 )

			// addr1 transfer all his tokens
			await hashStratDAOToken.connect(addr1).transfer( owner.address, await hashStratDAOToken.balanceOf(addr1.address) )

			// create a new distribution period
			await mineBlocks( (await divsDistributor.paymentInterval()).toNumber() )
			await divsDistributor.addDistributionInterval()
			
			// no divs to claim in new period
			expect( fromUsdc(await divsDistributor.claimableDivs(addr1.address)) ).to.be.equal( 0 )

		})
	});


	describe("#claimDivs", function () {

		it("pays dividends proportionally to a user tokens balance at the start of the distribution period", async function () {
			const { divsDistributor, hashStratDAOToken, usdc } = await loadFixture(deployDivsDistributorFixture);
			const [ owner, addr1, addr2 ] = await ethers.getSigners();

			// mint tokens to accounts
			await hashStratDAOToken.mint( addr1.address, toWei('10'))
			await hashStratDAOToken.mint( addr2.address, toWei('30'))
			await hashStratDAOToken.connect(addr1).autoDelegate()
			await hashStratDAOToken.connect(addr2).autoDelegate()

						
			// create distribution period
			await transferFunds( toUsdc('200').toString(), divsDistributor.address )
			await divsDistributor.addDistributionInterval()
			await mineBlocks(1)

			expect ( await usdc.balanceOf(addr1.address) ).to.be.equal( 0 )
			expect ( await usdc.balanceOf(addr2.address) ).to.be.equal( 0 )


			// addr1 claims divs
			await divsDistributor.connect(addr1).claimDivs()
			await divsDistributor.connect(addr2).claimDivs()

			await mineBlocks(1)

			expect ( await divsDistributor.claimedDivs(1, addr1.address) ).to.be.approximately( toUsdc('50'), 500)
			expect ( await divsDistributor.claimedDivs(1, addr2.address) ).to.be.approximately( toUsdc('150'), 500)

			expect ( await usdc.balanceOf(addr1.address) ).to.be.approximately( toUsdc('50'), 500)
			expect ( await usdc.balanceOf(addr2.address) ).to.be.approximately( toUsdc('150'), 500)
		})


		it("pays no dividends to users wheb no tokens have been minted", async function () {

			const { divsDistributor, hashStratDAOToken, usdc } = await loadFixture(deployDivsDistributorFixture);

			const [ owner, addr1, addr2 ] = await ethers.getSigners();

			// create distribution period
			await transferFunds( toUsdc('200').toString(), divsDistributor.address )
			await divsDistributor.addDistributionInterval()
			await mineBlocks(1)

			// mint tokens to accounts
			expect ( await hashStratDAOToken.totalSupply() ).to.be.equals( 0 )

		
			await mineBlocks(1)

			// addr1 claims divs
			await divsDistributor.connect(addr1).claimDivs()

			expect ( await divsDistributor.claimedDivs(1, addr1.address) ).to.be.equal( 0 )
			expect ( await usdc.balanceOf(addr1.address) ).to.be.equals( 0 )
		})


		it("pays no dividends to a user with no tokens at the beginning of the distribution period", async function () {

			const { divsDistributor, hashStratDAOToken, usdc } = await loadFixture(deployDivsDistributorFixture);

			const [ owner, addr1, addr2 ] = await ethers.getSigners();

			// create distribution period
			await transferFunds( toUsdc('200').toString(), divsDistributor.address )
			await divsDistributor.addDistributionInterval()
			await mineBlocks(1)

			// mint tokens to accounts
			await hashStratDAOToken.mint( addr1.address, toWei('10'))
			await hashStratDAOToken.mint( addr2.address, toWei('30'))
			await hashStratDAOToken.connect(addr1).autoDelegate()
			await hashStratDAOToken.connect(addr2).autoDelegate()
			
			await mineBlocks(1)

			// addr1 claims divs
			expect ( await usdc.balanceOf(addr1.address) ).to.be.equals( 0 )

			await divsDistributor.connect(addr1).claimDivs()
			expect ( await divsDistributor.claimedDivs(1, addr1.address) ).to.be.equal( 0 )
			expect ( await usdc.balanceOf(addr1.address) ).to.be.equals( 0 )
		})


		it("pays no dividends when a user did already claim", async function () {

			const { hashStratDAOToken, divsDistributor, usdc } = await loadFixture(deployDivsDistributorFixture);
			const [ owner, addr1, addr2 ] = await ethers.getSigners();

			// mint tokens to accounts
			await hashStratDAOToken.mint( addr1.address, toWei('10') )
			await hashStratDAOToken.mint( addr2.address, toWei('30') )
			await hashStratDAOToken.connect(addr1).autoDelegate()
			await hashStratDAOToken.connect(addr2).autoDelegate()

			// transfer some funds to divs distributor
			const amount = toUsdc('200').toString()
			await transferFunds(amount, divsDistributor.address)

			expect( fromUsdc(await usdc.balanceOf(divsDistributor.address)) ).to.be.equal( 200 )

			await divsDistributor.addDistributionInterval()
			await mineBlocks(1)
		
			await divsDistributor.connect(addr1).claimDivs()
			expect ( await usdc.balanceOf(addr1.address) ).to.be.equal( toUsdc('50') )

			await mineBlocks(1)

			await divsDistributor.connect(addr1).claimDivs()
			expect ( await usdc.balanceOf(addr1.address) ).to.be.equal( toUsdc('50') )
		});



		it("pays no dividends when a user tranfers all tokens before a new distribution period starts", async function () {
			const { hashStratDAOToken, divsDistributor, usdc } = await loadFixture(deployDivsDistributorFixture);

			const [ owner, addr1, addr2 ] = await ethers.getSigners();

			// mint tokens to addr1, addr2
			await hashStratDAOToken.mint( addr1.address, toWei('10'))
			await hashStratDAOToken.mint( addr2.address, toWei('30'))
			await hashStratDAOToken.connect(addr1).autoDelegate()
			await hashStratDAOToken.connect(addr2).autoDelegate()

			// transfer some funds to divs distributor
			const amount = toUsdc('200').toString()
			await transferFunds(amount, divsDistributor.address)

			expect( fromUsdc(await usdc.balanceOf(divsDistributor.address)) ).to.be.equal( 200 )

			await divsDistributor.addDistributionInterval()
			await mineBlocks(1)

			expect( await divsDistributor.getDistributionIntervalsCount() ).to.be.equal( 1 )
			expect( fromUsdc(await divsDistributor.claimableDivs(addr1.address)) ).to.be.equal( 50 )

			// addr1 transfer all his tokens
			await hashStratDAOToken.connect(addr1).transfer( owner.address, await hashStratDAOToken.balanceOf(addr1.address) )

			// create a new distribution period
			await mineBlocks( (await divsDistributor.paymentInterval()).toNumber() )
			await divsDistributor.addDistributionInterval()
			
			// addr1 claim no divs
			await divsDistributor.connect(addr1).claimDivs()
			expect( fromUsdc(await usdc.balanceOf(addr1.address)) ).to.be.equal( 0 )

		})
	
	});


});






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