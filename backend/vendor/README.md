# Vendored Python wheels

Wheels under `wheels/` are committed so clones can install backend deps without
hitting PyPI when possible (offline / first-run convenience).

Install (used automatically by `scripts/install.sh` and `scripts/start-backend.sh`):

```bash
python -m pip install --no-index --find-links=backend/vendor/wheels -r backend/requirements.txt
```

Covered platforms (binary wheels where needed): Windows amd64, Linux x86_64/aarch64,
macOS x86_64/arm64 — mainly for **Python 3.12**, plus Windows **3.14**.

If your Python/platform combo is missing a binary wheel, the start scripts fall
back to PyPI automatically.

Refresh wheels (maintainers):

```bash
python -m pip download -r backend/requirements.txt -d backend/vendor/wheels
# optional multi-platform:
# python -m pip download -r backend/requirements.txt -d backend/vendor/wheels \
#   --python-version 312 --platform manylinux2014_x86_64 --only-binary=:all:
```
