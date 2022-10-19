# HashStrat DAO

This repo constains the Solidity smart contracts for the HashStrat DAO.
More information about the HashStrat DAO is available in this [Medium articole](https://medium.com/@hashstrat/hashstrat-dao-c37fcdda1c1a).


## DAO Components

- HashStrat DAO Token (HST) (HashStratDAOToken.sol)
- HST Token Farm (HashStratDAOTokenFarm.sol)
- Protocol Dividends Distribution (DivsDistributor.sol)
- Governance (HashStratGovernor.sol, HashStratTimelockController.sol)
- DAO Operations (DAOOperations.sol)
- Treasury (Treasury.sol)

![DAO Components](https://miro.medium.com/max/4800/1*I5HaOLoL_eTPEzHg6-IljQ.png)


### HashStrat DAO Token (HST)
The token of the HashStrat DAO. 
A standard ERC20 token, with support for voting, with supply limited to 1M.


### HashStrat DAO Token Farm
Farming contract to distribute the entire supply of HST tokens to users of HashStrat Pools & Indexes.
Users who skake their LP tokens into HashStratDAOTokenFarm will receive HST tokens as a rewards.
The distribution scheduele is fixes to 10 years.


### Dividends Distributor
The component in charge of distributing protocol dividends to DAO token holders.


### Governor & Timelock
The Governor is the component that allows DAO token holders to submit, vote and execute new proposals. It is built on OpenZeppelin Governance modules and compatible with Compound Governor Bravo, a de-facto industry standard in DAO governance design.


### DAO Operations
This the smart contract that defines the operations that Governance can perform. In essence, these operations are the only changes that the protocol supports.


### DAO Treasury
The Treasury is component where protocol revenues, collected from the various Pools, are held until new payments are issued.


## Install Dependencies

```shell
brew install node                # Install Node (MacOS with Homebrew)
npm install --save-dev hardhat   # Install HardHat
npm install                      # Install dependencies

```

##  Run Tests
```shell
npx hardhat test
```

##  Deployment 
1. Edit `.env` file and provide mnemoncs and other environment variables.
2. run deployment script

```shell
npx hardhat run --network polygon scripts/deploy-polygon.ts
```
