interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    username: string;
    role: string;
    department?: string;
  };
}
