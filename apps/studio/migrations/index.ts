import * as migration_20261122_223531_initial from './20261122_223531_initial';

export const migrations = [
  {
    up: migration_20261122_223531_initial.up,
    down: migration_20261122_223531_initial.down,
    name: '20261122_223531_initial'
  },
];
