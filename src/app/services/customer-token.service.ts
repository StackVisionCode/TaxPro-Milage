import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { jwtDecode } from 'jwt-decode';

interface TaxVisionTokenClaims {
  sub: string;
  email: string;
  jti: string;
  sid: string;
  tenant_id: string;
  actor_type: string;
  customer_id?: string;
  role?: string | string[];
  zoneinfo?: string;
  exp: number;
}

export interface CustomerDecodedToken extends TaxVisionTokenClaims {
  nameid: string;
  companyId: string;
  roles: string[];
  portal: string[];
}

@Injectable({ providedIn: 'root' })
export class CustomerTokenService {
  private readonly TOKEN_KEY = 'customer_auth_token';
  private readonly REFRESH_TOKEN_KEY = 'customer_refresh_token';
  private tokenSubject = new BehaviorSubject<string | null>(
    this.getStoredToken()
  );

  decodeToken(): CustomerDecodedToken | null {
    const token = this.token;
    if (!token) return null;

    try {
      const claims = jwtDecode<TaxVisionTokenClaims>(token);
      const roles = claims.role
        ? Array.isArray(claims.role)
          ? claims.role
          : [claims.role]
        : [];

      return {
        ...claims,
        nameid: claims.customer_id ?? claims.sub,
        companyId: claims.tenant_id,
        roles,
        portal: claims.actor_type === 'CustomerPortal' ? ['customer'] : [],
      };
    } catch (error) {
      console.error('Error decoding customer token:', error);
      return null;
    }
  }

  getStoredToken(): string | null {
    return localStorage.getItem(this.TOKEN_KEY);
  }

  getStoredRefreshToken(): string | null {
    return localStorage.getItem(this.REFRESH_TOKEN_KEY);
  }

  setTokens(accessToken: string, refreshToken: string): void {
    localStorage.setItem(this.TOKEN_KEY, accessToken);
    localStorage.setItem(this.REFRESH_TOKEN_KEY, refreshToken);
    this.tokenSubject.next(accessToken);
  }

  removeTokens(): void {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.REFRESH_TOKEN_KEY);
    this.tokenSubject.next(null);
  }

  getCustomerIdFromToken(): string | null {
    return this.decodeToken()?.customer_id ?? null;
  }

  getUserIdFromToken(): string | null {
    return this.decodeToken()?.sub ?? null;
  }

  getCustomerDisplayNameFromToken(): string | null {
    return this.decodeToken()?.email ?? null;
  }

  getCustomerEmailFromToken(): string | null {
    return this.decodeToken()?.email ?? null;
  }

  getCompanyIdFromToken(): string | null {
    return this.decodeToken()?.tenant_id ?? null;
  }

  isCustomerPortalToken(): boolean {
    return this.decodeToken()?.actor_type === 'CustomerPortal';
  }

  getCustomerRoles(): string[] {
    return this.decodeToken()?.roles ?? [];
  }

  getCustomerPermissions(): string[] {
    return [];
  }

  get token$() {
    return this.tokenSubject.asObservable();
  }

  get token(): string | null {
    return this.tokenSubject.value;
  }

  get refreshToken(): string | null {
    return this.getStoredRefreshToken();
  }
}
