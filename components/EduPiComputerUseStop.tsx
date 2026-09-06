export const COMPUTER_USE_CHANGED_EVENT = "edupi-computer-use-changed";

export function announceComputerUseChanged(enabled: boolean): void {
  window.dispatchEvent(new CustomEvent<boolean>(COMPUTER_USE_CHANGED_EVENT, { detail: enabled }));
}
