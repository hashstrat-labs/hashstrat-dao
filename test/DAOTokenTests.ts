import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { fromUsdc, toWei } from "./helpers";

describe("HashStratDAOToken", function () {

	async function deployTokenFixture() {
		const HashStratDAOToken = await ethers.getContractFactory("HashStratDAOToken");
		const hashStratDAOToken = await HashStratDAOToken.deploy()
		await hashStratDAOToken.deployed()

		return { hashStratDAOToken };
	}


	describe("HashStratDAOTokenFarm", function () {
		it("has symbol HST", async function () {
			const { hashStratDAOToken } = await loadFixture(deployTokenFixture);
	
			expect( await hashStratDAOToken.symbol() ).to.equal('HST');
		});

		it("has 18 decimals", async function () {
			const { hashStratDAOToken } = await loadFixture(deployTokenFixture);
	
			expect( await hashStratDAOToken.decimals() ).to.equal(18);
		});

		it("has initial total supply of 0", async function () {
			const { hashStratDAOToken } = await loadFixture(deployTokenFixture);
	
			expect( ethers.utils.formatUnits (await hashStratDAOToken.totalSupply()) ).to.equal('0.0');
		});


		it("can mint up to 1_000_000 tokens", async function () {
			const { hashStratDAOToken } = await loadFixture(deployTokenFixture);
			const [addr1, addr2] = await ethers.getSigners();
			hashStratDAOToken.setFarmAddress(addr1.address)

			await hashStratDAOToken.mint(addr2.address, toWei('1000000'))
	
			expect( ethers.utils.formatUnits(await hashStratDAOToken.totalSupply()) ).to.equal('1000000.0');
		});
	

		it("reverts if trying to mint more than 1_000_000 tokens", async function () {
			const { hashStratDAOToken } = await loadFixture(deployTokenFixture);

			const [addr1, addr2] = await ethers.getSigners();
			hashStratDAOToken.setFarmAddress(addr1.address)
			await hashStratDAOToken.mint(addr2.address, toWei('1000000'))

			await expect( hashStratDAOToken.mint(addr2.address, 1) ).to.be.revertedWith("ERC20Votes: total supply risks overflowing votes");
		});
		
	});

})