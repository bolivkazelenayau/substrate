import type { GeometryGroup } from "../engine/geometry";
import { getRenderer } from "../engine/renderers";
import { rendererManifests } from "../engine/renderers/rendererManifest";
import type { ProjectState, RenderContext, RendererId } from "../types";
import type { GraphDocument, GraphNode } from "./graphTypes";
import { validateGraphDocument, type GraphValidationIssue } from "./graphValidation";

export type GraphExecutionBackend = "cpu";

/** The prototype's geometry value is the existing renderer geometry contract. */
export type GeometryIR = GeometryGroup;

export type GraphExecutionInput = {
  project: ProjectState;
  context: RenderContext;
};

export type GraphExecutionIssue =
  | {
      code: "graph-validation";
      message: string;
      validationIssue: GraphValidationIssue;
    }
  | {
      code: "unsupported-output-node";
      message: string;
      nodeId: string;
      nodeType: string;
    }
  | {
      code: "unknown-renderer";
      message: string;
      nodeId: string;
      rendererId: string;
    }
  | {
      code: "renderer-project-mismatch";
      message: string;
      nodeId: string;
      graphRendererId: RendererId;
      projectRendererId: RendererId;
    };

export type GraphExecutionResult =
  | {
      backend: GraphExecutionBackend;
      ok: true;
      outputNodeId: string;
      geometry: GeometryIR;
      issues: [];
    }
  | {
      backend: GraphExecutionBackend;
      ok: false;
      outputNodeId: string | null;
      geometry: null;
      issues: GraphExecutionIssue[];
    };

function rendererIdFromNode(node: GraphNode): string | null {
  const prefix = "renderer.";
  return node.type.startsWith(prefix) ? node.type.slice(prefix.length) : null;
}

function isRendererId(value: string): value is RendererId {
  return Object.prototype.hasOwnProperty.call(rendererManifests, value);
}

/**
 * Internal synchronous prototype only. Production preview/export continue to
 * call the renderer runtime directly.
 */
export function executeGraphCpu(
  graph: GraphDocument,
  input: GraphExecutionInput,
): GraphExecutionResult {
  const validationIssues = validateGraphDocument(graph);
  if (validationIssues.length > 0) {
    return {
      backend: "cpu",
      ok: false,
      outputNodeId: graph.outputNodeId || null,
      geometry: null,
      issues: validationIssues.map((validationIssue) => ({
        code: "graph-validation",
        message: validationIssue.message,
        validationIssue,
      })),
    };
  }

  const outputNode = graph.nodes.find(({ id }) => id === graph.outputNodeId)!;
  const rendererId = rendererIdFromNode(outputNode);
  if (rendererId === null) {
    return {
      backend: "cpu",
      ok: false,
      outputNodeId: outputNode.id,
      geometry: null,
      issues: [{
        code: "unsupported-output-node",
        message: `Graph output node "${outputNode.id}" has unsupported type "${outputNode.type}".`,
        nodeId: outputNode.id,
        nodeType: outputNode.type,
      }],
    };
  }
  if (!isRendererId(rendererId)) {
    return {
      backend: "cpu",
      ok: false,
      outputNodeId: outputNode.id,
      geometry: null,
      issues: [{
        code: "unknown-renderer",
        message: `Graph output node "${outputNode.id}" references unknown renderer "${rendererId}".`,
        nodeId: outputNode.id,
        rendererId,
      }],
    };
  }
  if (rendererId !== input.project.renderer) {
    return {
      backend: "cpu",
      ok: false,
      outputNodeId: outputNode.id,
      geometry: null,
      issues: [{
        code: "renderer-project-mismatch",
        message: `Graph renderer "${rendererId}" does not match project renderer "${input.project.renderer}".`,
        nodeId: outputNode.id,
        graphRendererId: rendererId,
        projectRendererId: input.project.renderer,
      }],
    };
  }

  const renderer = getRenderer(rendererId);
  return {
    backend: "cpu",
    ok: true,
    outputNodeId: outputNode.id,
    geometry: renderer.generateGeometry(input.project, input.context),
    issues: [],
  };
}
