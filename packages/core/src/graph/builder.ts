import { StateGraph, START, END, MemorySaver, BaseCheckpointSaver } from '@langchain/langgraph';
import { StateAnnotation, GraphState } from '../schemas/state.js';
import { createGraphNodes, NodeOptions } from './nodes.js';
import { routeAfterFactChecker, routeAfterEditor, ROUTE_TARGETS } from './routes.js';

export interface GraphBuilderOptions extends NodeOptions {
  checkpointer?: BaseCheckpointSaver;
}

export function createCiteWriterGraph(options: GraphBuilderOptions = {}) {
  const checkpointer = options.checkpointer ?? new MemorySaver();
  const nodes = createGraphNodes(options);

  const workflow = new StateGraph(StateAnnotation)
    .addNode(ROUTE_TARGETS.RESEARCHER, nodes.researcherNode)
    .addNode(ROUTE_TARGETS.PLANNER, nodes.contentPlannerNode)
    .addNode(ROUTE_TARGETS.WRITER, nodes.writerNode)
    .addNode(ROUTE_TARGETS.FACT_CHECKER, nodes.factCheckerNode)
    .addNode(ROUTE_TARGETS.EDITOR, nodes.editorNode)
    .addNode(ROUTE_TARGETS.PREPARE_REVIEW, nodes.prepareReviewNode)
    .addNode(ROUTE_TARGETS.HUMAN_REVIEW, nodes.humanReviewNode)
    // Edges
    .addEdge(START, ROUTE_TARGETS.RESEARCHER)
    .addEdge(ROUTE_TARGETS.RESEARCHER, ROUTE_TARGETS.PLANNER)
    .addEdge(ROUTE_TARGETS.PLANNER, ROUTE_TARGETS.WRITER)
    .addEdge(ROUTE_TARGETS.WRITER, ROUTE_TARGETS.FACT_CHECKER)
    // Route A conditional edge
    .addConditionalEdges(
      ROUTE_TARGETS.FACT_CHECKER,
      (state) => routeAfterFactChecker(state as GraphState),
      {
        [ROUTE_TARGETS.RESEARCHER]: ROUTE_TARGETS.RESEARCHER,
        [ROUTE_TARGETS.WRITER]: ROUTE_TARGETS.WRITER,
        [ROUTE_TARGETS.EDITOR]: ROUTE_TARGETS.EDITOR,
        [ROUTE_TARGETS.PREPARE_REVIEW]: ROUTE_TARGETS.PREPARE_REVIEW,
      },
    )
    // Route B conditional edge
    .addConditionalEdges(ROUTE_TARGETS.EDITOR, (state) => routeAfterEditor(state as GraphState), {
      [ROUTE_TARGETS.WRITER]: ROUTE_TARGETS.WRITER,
      [ROUTE_TARGETS.PREPARE_REVIEW]: ROUTE_TARGETS.PREPARE_REVIEW,
    })
    .addEdge(ROUTE_TARGETS.PREPARE_REVIEW, ROUTE_TARGETS.HUMAN_REVIEW)
    .addEdge(ROUTE_TARGETS.HUMAN_REVIEW, END);

  return workflow.compile({ checkpointer });
}
