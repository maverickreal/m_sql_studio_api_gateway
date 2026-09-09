import { describe, it, expect, vi, beforeEach } from 'vitest';
import { retrieve_all_assignments, retrieve_assignment } from '../index';
import { Request, Response } from 'express';
import * as services from '../../../services';

vi.mock('../../../config', () => ({
  envVars: { CLIENT_URL: 'http://localhost:3000' },
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../data', () => ({
  Assignment: {
    find: vi.fn(),
    countDocuments: vi.fn(),
  },
}));

vi.mock('../../../services', () => ({
  getAssignmentByIdCached: vi.fn(),
}));

import { Assignment } from '../../../data';

describe('Assignment Controller', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let jsonMock: any;
  let statusMock: any;

  beforeEach(() => {
    jsonMock = vi.fn();
    statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    res = {
      status: statusMock,
      json: jsonMock,
      set: vi.fn().mockReturnThis(),
    };
    vi.clearAllMocks();
  });

  describe('retrieve_all_assignments', () => {
    it('should return 200 with paginated assignments', async () => {
      const mockAssignments = [{ _id: '1', title: 'Test Assignment', difficulty: 'easy' }];
      (Assignment.find as any).mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue(mockAssignments),
      });
      (Assignment.countDocuments as any).mockResolvedValue(1);

      req = { query: {} };
      await retrieve_all_assignments(req as Request, res as Response);

      expect(Assignment.find).toHaveBeenCalledWith(
        { pgSchemaReady: true },
        { _id: 1, title: 1, difficulty: 1, mode: 1 },
      );
      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith({
        assignments: mockAssignments,
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
    });

    it('should respect page and limit query params', async () => {
      const mockAssignments = [{ _id: '2', title: 'Test 2', difficulty: 'medium' }];
      (Assignment.find as any).mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue(mockAssignments),
      });
      (Assignment.countDocuments as any).mockResolvedValue(21);

      req = { query: { page: '2', limit: '10' } };
      await retrieve_all_assignments(req as Request, res as Response);

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith({
        assignments: mockAssignments,
        page: 2,
        limit: 10,
        total: 21,
        totalPages: 3,
      });
    });
  });

  describe('retrieve_assignment', () => {
    it('should return 200 and the assignment if it exists and is ready', async () => {
      req = { params: { id: '507f1f77bcf86cd799439011' } };
      const mockAssignment = { _id: '507f1f77bcf86cd799439011', title: 'Test Assignment', pgSchemaReady: true };
      (services.getAssignmentByIdCached as any).mockResolvedValue(mockAssignment);

      await retrieve_assignment(req as Request, res as Response);

      expect(services.getAssignmentByIdCached).toHaveBeenCalledWith('507f1f77bcf86cd799439011');
      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith({ assignment: mockAssignment });
    });

    it('should return 404 if assignment is not found', async () => {
      req = { params: { id: '507f1f77bcf86cd799439011' } };
      (services.getAssignmentByIdCached as any).mockResolvedValue(null);

      await retrieve_assignment(req as Request, res as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Assignment not found!' });
    });

    it('should return 503 if assignment exists but schema is not ready', async () => {
      req = { params: { id: '507f1f77bcf86cd799439011' } };
      const mockAssignment = { _id: '507f1f77bcf86cd799439011', title: 'Test Assignment', pgSchemaReady: false };
      (services.getAssignmentByIdCached as any).mockResolvedValue(mockAssignment);

      await retrieve_assignment(req as Request, res as Response);

      expect(statusMock).toHaveBeenCalledWith(503);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Assignment unavailable at the moment!' });
    });
  });
});
