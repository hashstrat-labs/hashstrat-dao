import { BigNumber } from "ethers";
import { ethers, network } from "hardhat";

import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";


export const round = (n : number, d=2) => {
    return Math.round(n * (10**d)) / (10**d)
}

export const fromWei = (value : BigNumber, d=18) : Number => {
    if (d==18) return Number(ethers.utils.formatUnits(value, 'ether'))
    if (d==9) return Number(ethers.utils.formatUnits(value, 'gwei'))
    if (d==6) return Number(ethers.utils.formatUnits(value, 'mwei'))

    throw Error(`not supported decimal: ${d}`)
}

export const toWei = (value : string, d=18) => {
    if (d==18) return ethers.utils.parseUnits(value, 'ether')
    if (d==9) return ethers.utils.parseUnits(value, 'gwei')
    if (d==6) return ethers.utils.parseUnits(value, 'mwei')

    throw Error(`not supported decimal: ${d}`)
}

export const fromUsdc = (v: BigNumber) => {
    return Number(ethers.utils.formatUnits(v , 'mwei'))
}

export const toUsdc = (value: string) => {
    return ethers.utils.parseUnits(value, 'mwei')
}


export async function waitDays(days: number) {
	const DAYS_IN_SECS =  days * 24 * 60 * 60;
	const daysInSecs = (await time.latest()) + DAYS_IN_SECS
	await time.increaseTo(daysInSecs)
}


export async function mineBlocks(blocks: number) {
    await network.provider.send("hardhat_mine", ['0x' + blocks.toString(16) ] );
}