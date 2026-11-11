import { ResourceCategory } from '../../db/schema';

export interface ResourceItem {
  id: string;
  title: string;
  description: string | null;
  url: string;
  category: ResourceCategory;
  tags: string[];
  creatorId: string;
  creatorName: string;
  createdAt: string;
  updatedAt: string;
}
