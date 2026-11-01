import { readConfig } from "./config";
import { createSignalServer } from "./server";
import { cloudflareTurn } from "./turn";

const config = readConfig(process.env);
const turn = config.turn
  ? cloudflareTurn({
      keyId: config.turn.keyId,
      apiToken: config.turn.apiToken,
      ttlSeconds: config.turn.ttlSeconds,
    })
  : undefined;
const service = createSignalServer({ config, turn });

service.server.listen(config.port, config.host, () => {
  console.log(
    JSON.stringify({
      event: "listening",
      host: config.host,
      port: config.port,
      turn: Boolean(turn),
    }),
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void service.close().then(() => process.exit(0));
  });
