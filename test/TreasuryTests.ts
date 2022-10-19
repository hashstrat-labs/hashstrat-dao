import { expect } from "chai";
import { BigNumber, Contract } from "ethers"

import { ethers, network } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { fromUsdc, toUsdc, round } from "./helpers"

import abis from "./abis/abis.json";

const usdcAddress = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
const usdcSource = '0xe7804c37c13166ff0b37f5ae0bb07a3aebb6e245' // rich account owing 48,354,222.149244  USDC

const poolOwner = '0x4F888d90c31c97efA63f0Db088578BB6F9D1970C'


describe("Treasury", function () {


	async function deployTreasuryFixture() {

		// the existing usdc contract on the network
		const usdc = new Contract(usdcAddress, abis["erc20"], ethers.provider)

		const Treasury = await ethers.getContractFactory("Treasury");
		const treasury = await Treasury.deploy(usdc.address)
		await treasury.deployed()

		// add some funds to the treasury
		await transferFunds(1000 * 10 ** 6, treasury.address)

		return { treasury, usdc };
	}

	describe("#getBalance", function () {
		it("hreturn the treasury balance", async function () {
			const { treasury, usdc } = await loadFixture(deployTreasuryFixture);
	
			expect( await treasury.getBalance()).to.be.greaterThan(0)

			expect( await treasury.getBalance() ).to.equal( await usdc.balanceOf(treasury.address) );
		});
	})

	describe("#transferFunds", function () {
		it("transfer the specified amount to the recipient", async function () {
			const { treasury, usdc } = await loadFixture(deployTreasuryFixture);

			const [ owner, addr1 ] = await ethers.getSigners();

			const balanceBefore = await usdc.balanceOf(addr1.address)

			await treasury.connect(owner).transferFunds( addr1.address, toUsdc('100') )

			expect(  (await usdc.balanceOf(addr1.address)).sub(balanceBefore) ).to.equal( toUsdc('100') );
		});
	})

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
