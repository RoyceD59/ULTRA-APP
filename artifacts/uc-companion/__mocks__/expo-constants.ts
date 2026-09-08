export enum ExecutionEnvironment {
  Bare = 'bare',
  Standalone = 'standalone',
  StoreClient = 'storeClient',
}

const Constants = {
  executionEnvironment: ExecutionEnvironment.Standalone,
};

export function _setExecutionEnvironment(value: ExecutionEnvironment): void {
  Constants.executionEnvironment = value;
}

export function _reset(): void {
  Constants.executionEnvironment = ExecutionEnvironment.Standalone;
}

export default Constants;