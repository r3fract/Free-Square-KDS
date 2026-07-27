import { SquareClient, SquareEnvironment } from "square";
import { config } from "../config/env";

export const squareClient = new SquareClient({
  token: config.SQUARE_ACCESS_TOKEN,
  environment:
    config.SQUARE_ENVIRONMENT === "production"
      ? SquareEnvironment.Production
      : SquareEnvironment.Sandbox,
});
