'use client';

import { useMemo, useEffect } from 'react';
import ReactFlow, {
  Background,
  Controls,
  Node,
  Edge,
  Position,
  Handle,
  useNodesState,
  useEdgesState,
} from 'reactflow';
import dagre from 'dagre';
import 'reactflow/dist/style.css';

// 노드 상태 타입
export type NodeStatus = 'success' | 'failed' | 'in_progress' | 'cancelled';

// 트리 데이터 타입 정의
export interface TreeNode {
  id: string;
  name: string;
  status: NodeStatus;
  duration?: string; // 예: "1분 40초"
  children?: TreeNode[];
  // 하위 호환성을 위해 label도 지원 (name으로 매핑)
  label?: string;
}

interface DagreTreeProps {
  treeData?: TreeNode;
}

// 노드의 기본 크기 정의
const nodeMinWidth = 200; // 최소 너비
const nodeHeight = 100;
const nodePadding = 16; // 좌우 패딩 (p-4 = 16px)
const statusBadgeWidth = 24; // 상태 배지 너비 (w-6 = 24px)
const gapBetween = 8; // 이름과 배지 사이 간격 (pr-2 = 8px)
const fontSize = 14; // text-sm = 14px

// 텍스트 너비 계산 함수 (대략적인 계산)
function calculateTextWidth(text: string, fontSize: number): number {
  // 대략적인 계산: 평균 문자 너비는 fontSize * 0.6
  // 더 정확한 계산을 원하면 Canvas API 사용 가능
  const avgCharWidth = fontSize * 0.6;
  return text.length * avgCharWidth;
}

// 노드 너비 계산 함수
function calculateNodeWidth(name: string): number {
  const textWidth = calculateTextWidth(name, fontSize);
  const totalWidth = nodePadding * 2 + textWidth + gapBetween + statusBadgeWidth + nodePadding * 2;
  return Math.max(nodeMinWidth, totalWidth);
}

// TreeNode를 ReactFlow Node와 Edge로 변환
function treeToNodesAndEdges(
  tree: TreeNode,
  parentId?: string
): { nodes: Node[]; edges: Edge[]; nodeInfo: Map<string, { hasChildren: boolean; hasParent: boolean }> } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const nodeInfo = new Map<string, { hasChildren: boolean; hasParent: boolean }>();

  // 현재 노드 정보 저장
  const hasChildren = !!(tree.children && tree.children.length > 0);
  const hasParent = !!parentId;
  nodeInfo.set(tree.id, { hasChildren, hasParent });

  // 현재 노드 추가
  const nodeName = tree.name || tree.label || '';
  const calculatedWidth = calculateNodeWidth(nodeName);
  
  nodes.push({
    id: tree.id,
    data: { 
      name: nodeName,
      status: tree.status,
      duration: tree.duration,
      hasChildren,
      hasParent,
      width: calculatedWidth, // 계산된 너비 저장
    },
    type: 'custom', // 커스텀 노드 타입 사용
    position: { x: 0, y: 0 }, // Dagre가 계산함
  });

  // 부모와의 연결 추가
  if (parentId) {
    edges.push({
      id: `${parentId}-${tree.id}`,
      source: parentId,
      target: tree.id,
      type: 'default',
      animated: false, // 애니메이션 제거
    });
  }

  // 자식 노드들 재귀적으로 처리
  if (tree.children) {
    tree.children.forEach((child) => {
      const { nodes: childNodes, edges: childEdges, nodeInfo: childNodeInfo } = treeToNodesAndEdges(
        child,
        tree.id
      );
      nodes.push(...childNodes);
      edges.push(...childEdges);
      // 자식 노드 정보 병합
      childNodeInfo.forEach((value, key) => {
        nodeInfo.set(key, value);
      });
    });
  }

  return { nodes, edges, nodeInfo };
}

// 트리 구조를 순회하면서 Y 좌표를 계산하는 함수
function calculateYPositions(
  tree: TreeNode,
  nodeMap: Map<string, Node>,
  parentY: number = 0,
  xOffset: number = 0
): void {
  const node = nodeMap.get(tree.id);
  if (!node) return;

  // 현재 노드의 Y 좌표 설정 (부모의 Y 좌표 상속)
  const width = (node.data as CustomNodeData).width || nodeMinWidth;
  node.position = {
    x: xOffset,
    y: parentY - nodeHeight / 2,
  };

  // 자식 노드들 처리
  if (tree.children && tree.children.length > 0) {
    const nextXOffset = xOffset + 200; // 다음 레벨의 X 오프셋
    let childY = parentY; // 첫 번째 자식은 부모와 같은 Y 좌표

    tree.children.forEach((child) => {
      calculateYPositions(child, nodeMap, childY, nextXOffset);
      childY -= -nodeHeight - 20; // 다음 자식은 -1씩 (노드 높이 + 간격)
    });
  }
}

// Dagre를 사용한 레이아웃 함수 (왼쪽에서 오른쪽, Y 좌표는 수동 계산)
function getLayoutedElements(nodes: Node[], edges: Edge[], rootTree: TreeNode) {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({
    rankdir: 'LR', // Left to Right
    nodesep: 100, // 노드 간 간격
    ranksep: 150, // 레벨 간 간격
  });

  nodes.forEach((node) => {
    // 노드 데이터에서 계산된 너비 사용, 없으면 최소 너비 사용
    const width = (node.data as CustomNodeData).width || nodeMinWidth;
    dagreGraph.setNode(node.id, { width, height: nodeHeight });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  // 노드 맵 생성
  const nodeMap = new Map<string, Node>();
  nodes.forEach((node) => {
    nodeMap.set(node.id, node);
  });

  // Y 좌표를 수동으로 계산 (X는 Dagre가 계산한 값 사용)
  calculateYPositions(rootTree, nodeMap, 0, 0);

  // X 좌표는 Dagre가 계산한 값 사용, Y는 수동 계산한 값 사용
  nodes.forEach((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    const width = (node.data as CustomNodeData).width || nodeMinWidth;
    // 연결점 위치 설정 (좌우)
    node.targetPosition = Position.Left;
    node.sourcePosition = Position.Right;
    // X는 Dagre가 계산한 값, Y는 수동 계산한 값
    node.position = {
      x: nodeWithPosition.x - width / 2,
      y: node.position.y, // 수동 계산한 Y 좌표 사용
    };
  });

  return { nodes, edges };
}

// 기본 예제 트리 데이터 (GitHub Actions 스타일)
const defaultTreeData: TreeNode = {
  id: 'checkout',
  name: 'Checkout code',
  status: 'success',
  duration: '30초',
  children: [
    {
      id: 'setup-node',
      name: 'Setup Node.js',
      status: 'success',
      duration: '45초',
      children: [
        {
          id: 'install-deps',
          name: 'Install dependencies',
          status: 'success',
          duration: '1분 20초',
          children: [
            { id: 'test', name: 'Run tests', status: 'success', duration: '2분 15초' },
            { id: 'build', name: 'Build', status: 'in_progress', duration: '1분 40초' },
          ],
        },
      ],
    },
    {
      id: 'lint',
      name: 'Lint',
      status: 'failed',
      duration: '15초',
      children: [
        { id: 'lint-test', name: 'Lint test', status: 'success', duration: '5초' },
        { id: 'lint-build', name: 'Lint build', status: 'in_progress', duration: '10초' },
      ],
    },
  ],
};

// 아이콘 컴포넌트
const CheckIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

const XIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const LoaderIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
  </svg>
);

const CircleSlashIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const CircleIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="10" />
  </svg>
);

// 상태별 설정
const getStatusConfig = (status: NodeStatus) => {
  switch (status) {
    case 'success':
      return {
        icon: CheckIcon,
        bgColor: 'bg-green-600',
        iconColor: 'text-white',
      };
    case 'failed':
      return {
        icon: XIcon,
        bgColor: 'bg-red-600',
        iconColor: 'text-white',
      };
    case 'in_progress':
      return {
        icon: LoaderIcon,
        bgColor: 'bg-yellow-500',
        iconColor: 'text-white',
        isSpinning: true,
      };
    case 'cancelled':
      return {
        icon: CircleSlashIcon,
        bgColor: 'bg-gray-400',
        iconColor: 'text-white',
      };
    default:
      return {
        icon: CircleIcon,
        bgColor: 'bg-gray-400',
        iconColor: 'text-white',
      };
  }
};

// 상태 배지 컴포넌트
const StatusBadge = ({ status }: { status: NodeStatus }) => {
  const config = getStatusConfig(status);
  const Icon = config.icon;

  return (
    <div
      className={`flex items-center justify-center rounded-full h-6 w-6 ${config.bgColor}`}
    >
      <Icon
        className={`h-4 w-4 ${config.iconColor} ${config.isSpinning ? 'animate-spin' : ''}`}
      />
    </div>
  );
};

// 커스텀 노드 컴포넌트 (연결점 조건부 표시)
interface CustomNodeData {
  name: string;
  status: NodeStatus;
  duration?: string;
  hasChildren?: boolean;
  hasParent?: boolean;
  width?: number; // 계산된 너비
}

const CustomNode = ({ data }: { data: CustomNodeData }) => {
  const hasParent = data.hasParent ?? false;
  const hasChildren = data.hasChildren ?? false;

  return (
    <div className="relative">
      {/* 왼쪽 연결점 (부모가 있을 때만 표시) */}
      {hasParent && (
        <Handle
          type="target"
          position={Position.Left}
          style={{ background: '#555' }}
        />
      )}
      
      {/* 카드 */}
      <div 
        className="border border-gray-200 rounded-md bg-white shadow-sm"
        style={{ 
          width: data.width || nodeMinWidth,
          minWidth: nodeMinWidth 
        }}
      >
        <div className="p-4">
          {/* 헤더: 이름과 상태 배지 */}
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-gray-900 whitespace-nowrap flex-1 min-w-0">
              {data.name}
            </div>
            <StatusBadge status={data.status} />
          </div>
          
          {/* Duration 표시 */}
          {data.duration && (
            <div className="text-xs text-gray-600">{data.duration}</div>
          )}
        </div>
      </div>
      
      {/* 오른쪽 연결점 (자식이 있을 때만 표시) */}
      {hasChildren && (
        <Handle
          type="source"
          position={Position.Right}
          style={{ background: '#555' }}
        />
      )}
    </div>
  );
};

const nodeTypes = {
  custom: CustomNode,
};

export default function DagreTree({ treeData }: DagreTreeProps) {
  // 트리 데이터를 노드와 엣지로 변환하고 레이아웃 계산
  const { nodes: layoutedNodes, edges: layoutedEdges } = useMemo(() => {
    const data = treeData || defaultTreeData;
    const { nodes, edges } = treeToNodesAndEdges(data);
    return getLayoutedElements(nodes, edges, data);
  }, [treeData]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutedEdges);

  // treeData가 변경되면 노드와 엣지 업데이트
  useEffect(() => {
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
  }, [layoutedNodes, layoutedEdges, setNodes, setEdges]);

  return (
    <div className="w-full h-screen">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodesDraggable={false} // 노드 드래그 비활성화
        nodesConnectable={false} // 노드 연결 비활성화
        elementsSelectable={false} // 요소 선택 비활성화
        nodeTypes={nodeTypes}
        defaultEdgeOptions={{
          type: 'straight',
          animated: false,
        }}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        attributionPosition="bottom-left"
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}

