export function availableQuantity(onHand: number, reserved: number): number {
  return Math.max(0, onHand - reserved);
}
