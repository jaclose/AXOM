import type { AxomState } from "../lib/types";

export interface CloudUser {
  id: string;
  displayName: string;
  normalizedName: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
  pinEnabled?: boolean;
  lockedUntil?: string;
  authNote?: string;
}

export interface CloudSession {
  id: string;
  userId: string;
  token: string;
  deviceLabel?: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export interface CloudSnapshot {
  id: string;
  userId: string;
  appVersion: string;
  schemaVersion: number;
  dataJson: AxomState;
  deviceLabel?: string;
  backupLabel?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CloudBackup {
  id: string;
  userId: string;
  appVersion: string;
  schemaVersion: number;
  deviceLabel?: string;
  backupLabel?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SyncMeta {
  user?: CloudUser;
  session?: CloudSession;
  autoSync: boolean;
  lastSyncedAt?: string;
  lastCloudUpdatedAt?: string;
  lastLocalFingerprint?: string;
  deviceLabel?: string;
}

export interface SaveCloudInput {
  appVersion: string;
  schemaVersion: number;
  dataJson: AxomState;
  deviceLabel?: string;
  backupLabel?: string;
}

export interface BackendHealth {
  ok: boolean;
  service: string;
  version: string;
  databaseConfigured: boolean;
  aiProvider: string;
  schemaVersion: number;
}
