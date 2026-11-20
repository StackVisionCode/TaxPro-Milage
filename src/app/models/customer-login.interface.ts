export interface ICustomerLogin {
  email: string;
  password: string;
  tenantId?: string;
}

export interface ICustomerTenantOption {
  tenantId: string;
  name: string;
  subdomain: string;
  mfaRequired: boolean;
}

export interface ICustomerTenantLoginRequest {
  discoverySessionRef: string;
  tenantId: string;
  mfaCode?: string;
  rememberDevice?: boolean;
}

export interface ICustomerLoginResponse {
  requiresTenantSelection: boolean;
  discoverySessionRef?: string;
  offices: ICustomerTenantOption[];
  accessToken?: string;
  refreshToken?: string;
  expiresInSeconds?: number;
  mfaSetupRequired: boolean;
  takeoverRequired: boolean;
  takeoverTicket?: string;
  takeoverTicketExpiresInSeconds?: number;
  deviceToken?: string;
}

export interface IAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  deviceToken?: string;
}

export interface ITakeoverResponse {
  takeoverRequired: boolean;
  mfaSetupRequired?: boolean;
  tokens?: IAuthTokens;
}

export interface ICustomerTenantProfile {
  id: string;
  name: string;
  subDomain: string;
  defaultTimeZoneId: string;
}

export interface ICustomerProfile {
  customerId: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  companyId: string;
  actorType: string;
  tenant: ICustomerTenantProfile;
  roles: string[];
  permissions: string[];
  timeZoneId: string;
}

export interface IMeResponse {
  id: string;
  name: string;
  lastName: string;
  email: string;
  actorType: string;
  customerId: string | null;
  tenant: ICustomerTenantProfile;
  roles: string[];
  permissions: string[];
  timeZoneId: string;
  phoneNumber?: string | null;
}

export interface IMyCustomerContactResponse {
  primaryPhone: string | null;
  primaryEmail: string;
  avatarFileId: string | null;
  pendingAvatarFileId?: string | null;
  avatarUploadStatus?: string | null;
  avatarModerationStatus?: string | null;
  avatarModerationFileId?: string | null;
}

export interface IMyCustomerAvatarUploadResponse {
  fileId: string;
  status: 'processing';
}
