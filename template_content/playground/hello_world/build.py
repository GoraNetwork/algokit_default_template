from pathlib import Path

from playground.hello_world import helloworld


def build() -> Path:
    app_spec = helloworld.app.build()
    output_dir = Path(__file__).parent / "artifacts"
    app_spec.export(output_dir)
    return output_dir / "application.json"


if __name__ == "__main__":
    build()
