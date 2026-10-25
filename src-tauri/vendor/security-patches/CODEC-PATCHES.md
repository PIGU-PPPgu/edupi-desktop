# Optional image codec macro maintenance

The xcap `image` feature retains all upstream formats. Cargo resolves that
optional feature for the test workspace, including rav1e and pulp. Their old
`paste` dependency is no longer maintained.

Official source archives, with original package names, versions and licenses:

| Package | Version | Archive SHA-256 | License |
| --- | --- | --- | --- |
| rav1e | 0.8.1 | `43b6dd56e85d9483277cde964fd1bdb0428de4fec5ebba7540995639a21cb32b` | BSD-2-Clause |
| pulp | 0.22.3 | `046aa45b989642ec2e4717c8e72d677b13edd831a4d3b6cf37d9a3e54912496a` | MIT |

Only each normalized manifest's `paste` dependency is aliased to the maintained
published `pastey = 0.1.1`. Original manifests and Rust sources are preserved.
The maintained crate retains `paste!`, `item!` and `expr!`, so existing macro
call sites are unchanged. Its official archive SHA-256 is
`35fb2e5f958ec131621fdd531e9fc186ed768cbe395337403ae56c17a74c68ec`.
See [the migration documentation](https://docs.rs/pastey/0.1.1/pastey/).

This uses a maintained published implementation; it does not assign a new
version to the discontinued crate. The complete lock and optional xcap codec
source check remain required. Remove these parent patches after published
rav1e/pulp versions use a maintained macro dependency and pass the same checks.
