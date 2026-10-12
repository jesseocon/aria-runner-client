# aria-runner-client

Server-only client for the runner API. Install it in Aria's backend. Do not import it from a browser.

```bash
npm install git+https://github.com/YOUR_ORG/aria-runner-client.git
```

`npm install` compiles the package. The `ark_` key stays in the server environment.

```ts
import { createRunner } from "aria-runner-client";

const runner = createRunner({
  baseUrl: process.env.ARIA_RUNNER_API_URL!,
  apiKey: process.env.ARIA_RUNNER_API_KEY!,
  tenantId: process.env.ARIA_RUNNER_TENANT_ID!,
});
```

`organizationId` is the Aria organization. `propertyId` is the Aria property id for this environment. A new connector writes `environments: ["development"]` until you pass something else in `config`.

```ts
const login = await runner.createLogin({
  name: "Lighthouse",
  organizationId: "1001",
  username: "ada@example.com",
  password: "secret",
});

await runner.createConnector({
  id: "hotel-lighthouse",
  type: "lighthouse",
  name: "Example Hotel",
  organizationId: "1001",
  propertyId: "property-dev",
  productionPropertyId: "property-prod",
  loginId: login.id,
  config: { hotel_id: "123", streams: ["room-type"] },
});

await runner.listConnectors({ organizationId, propertyId });
await runner.patchConnector(id, { name: "Example Hotel" });
await runner.associateLogin(id, login.id);

await runner.getSettings(id);
await runner.saveSettings(id, { username: "ada@example.com", password: "secret" });
```

`getSettings` and `saveSettings` are the connector's username and password. A connector that already has a login updates that shared login. `getLoginSettings` and `saveLoginSettings` do the same on the login itself. Secret values already stored are not returned; send a blank secret to keep the saved one.

A vendor property id, such as a CoStar id, stays in `config.property_id`. `propertyId` is only the Aria property.
