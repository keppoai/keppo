import connector from "./connector.js";
import { createConnectorToolsFacet } from "../shared.js";

export const tools = createConnectorToolsFacet("custom", connector);
