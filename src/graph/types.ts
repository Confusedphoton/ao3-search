export enum NodeKind {
  Work = 0,
  Tag = 1,
  Author = 2,
}

export interface GraphNode {
  id: number;
  kind: NodeKind;
  key: string;
  title?: string;
  estimatedFreq: number;
  calibratedFreq: number | null;
  explored: boolean;
}

export interface GraphEdge {
  workNodeId: number;
  tagNodeId: number;
}

export interface AuthorWorkEdge {
  workNodeId: number;
  authorNodeId: number;
}

export interface GraphSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
  authorEdges: AuthorWorkEdge[];
}

export interface WorkAuthorInput {
  key: string;
  displayName: string;
}

export interface WorkMergeInput {
  workId: string;
  title: string;
  tags: string[];
  authors: WorkAuthorInput[];
  explored?: boolean;
}

export interface TagMergeInput {
  tagName: string;
  workCount: number | null;
  workIds: string[];
  explored?: boolean;
}

export interface AuthorMergeInput {
  authorKey: string;
  displayName: string;
  workCount: number | null;
  workIds: string[];
  explored?: boolean;
}
