export enum NodeKind {
  Work = 0,
  Tag = 1,
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

export interface GraphSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface WorkMergeInput {
  workId: string;
  title: string;
  tags: string[];
  explored?: boolean;
}

export interface TagMergeInput {
  tagName: string;
  workCount: number | null;
  workIds: string[];
  explored?: boolean;
}
