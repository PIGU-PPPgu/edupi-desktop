export type ActivationRequest = {
  id: number;
  signal: AbortSignal;
};

type CurrentActivationRequest = ActivationRequest & {
  controller: AbortController;
};

export type ActivationRequestTracker = {
  begin: () => ActivationRequest;
  cancel: () => void;
  isCurrent: (request: ActivationRequest) => boolean;
};

export function createActivationRequestTracker(): ActivationRequestTracker {
  let nextId = 0;
  let current: CurrentActivationRequest | null = null;

  return {
    begin() {
      current?.controller.abort();
      const controller = new AbortController();
      const request = { id: ++nextId, signal: controller.signal, controller };
      current = request;
      return request;
    },
    cancel() {
      current?.controller.abort();
      current = null;
      nextId += 1;
    },
    isCurrent(request) {
      return current?.id === request.id
        && current.signal === request.signal
        && !request.signal.aborted;
    },
  };
}
