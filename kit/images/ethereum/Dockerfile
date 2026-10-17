# The kit's Ethereum chain: anvil booted from the ENS snapshot `kit bake-ens` dumped, with no endpoint behind it, so
# every ENS read the kit makes answers from the snapshot alone. The snapshot is committed beside this file.
ARG FOUNDRY_VERSION
FROM ghcr.io/foundry-rs/foundry:${FOUNDRY_VERSION}
COPY mainnet-fork.json.gz /tmp/mainnet-fork.json.gz
RUN gunzip -k /tmp/mainnet-fork.json.gz
EXPOSE 8545
# The arguments come from the kit as the service's command, the same list the bake checked the snapshot with.
ENTRYPOINT ["anvil"]
