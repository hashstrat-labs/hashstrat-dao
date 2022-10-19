import { constants, utils, Contract } from "ethers"
import { ethers } from "hardhat";
import { fromUsdc, toUsdc, mineBlocks, toWei } from "../test/helpers"

import abis from "./abis/abis.json";

const usdcAddress = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
const usdcSource = '0xe7804c37c13166ff0b37f5ae0bb07a3aebb6e245' // rich USDC account
const divDistributorAddress = '0x35c1D11D1A28Aa454386C9A13dFa7dA773caFA1F'


async function main() {

	const divsDistributor = new Contract(divDistributorAddress, abis["divs_distributor"], ethers.provider)

	console.log("getDistributionIntervalsCount:" , ( await divsDistributor.getDistributionIntervalsCount() ).toString() )
	console.log("claimableDivs:" , fromUsdc(await divsDistributor.claimableDivs('0x209f4a997883Ac8e5f686ec59DD1DC47fccE4FAd')) )

}


main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
