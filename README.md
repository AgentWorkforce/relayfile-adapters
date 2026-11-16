# Relayfile Adapters

Adapters translate the records and events in each connected service into Relayfile’s common file tree, so agents can use different tools in a consistent way.

<p align="center">
  <img src="assets/banner.png" alt="Relayfile Adapters — map any SaaS into the relayfile filesystem" />
</p>

```
GitHub/GitLab/Slack/...
        │ webhook
        ▼
   ┌─────────┐     ┌──────────┐     ┌──────────┐
   │ Adapter  │────▶│ Provider │────▶│ relayfile│
   │ (paths,  │     │ (auth,   │     │ (VFS     │
   │  webhook │     │  proxy)  │     │  storage)│
   │  normal- │     └──────────┘     └──────────┘
   │  ization)│           │
   └─────────┘           │ writeback
        ▲                 ▼
        │           External API
        └─────────────────┘
```


## Get started

See the [repository guide](docs/repository-guide.md) for the supported setup, current limitations and technical reference.

## License

MIT
