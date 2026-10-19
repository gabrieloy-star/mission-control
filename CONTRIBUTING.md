# Contributing

Thanks for helping. Bug reports and ideas are welcome as issues.

## Before a pull request

- Open an issue first for anything bigger than a small fix, so we can agree on it.
- Keep the plugin's rules: it never calls the model on its own, sends nothing over the network, and costs no tokens to watch.
- Run the checks from the repository folder:

```bash
claude plugin validate . --strict
claude plugin test .
```

- Use Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`).

By contributing you agree that your work is released under the MIT License of this repository.
