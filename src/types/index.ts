export interface ServiceClient {
  connect(): Promise<void> | void;
  disconnect(): Promise<void>;
}

export interface AuthUser {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  image?: string | null;
  role?: string | null;
  banned?: boolean | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthSessionData {
  id: string;
  userId: string;
  expiresAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

declare global {
  namespace Express {
    interface Request {
      user: AuthUser | null;
      session: AuthSessionData | null;
      rawBody?: Buffer;
    }
  }
}
