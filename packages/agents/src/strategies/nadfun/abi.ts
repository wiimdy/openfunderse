import { parseAbi } from 'viem';

export const curveAbi = parseAbi([
  'event CurveBuy(address indexed sender,address indexed token,uint256 amountIn,uint256 amountOut)',
  'function isGraduated(address token) view returns (bool)',
  'function isLocked(address token) view returns (bool)'
]);

export const lensAbi = parseAbi([
  'function getAmountOut(address token,uint256 amountIn,bool isBuy) view returns (address router,uint256 amountOut)',
  'function getProgress(address token) view returns (uint16)'
]);

