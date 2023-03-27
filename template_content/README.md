# {{ project_name }}

This project has been generated using AlgoKit. See below for default getting started instructions.

# Setup

### Initial setup

1. Clone this repository locally
2. Install pre-requisites:
   - Install `AlgoKit` - [Link](https://github.com/algorandfoundation/algokit-cli#install): Ensure you can execute `algokit --version`.
   - Bootstrap your local environment; run `algokit bootstrap all` within this folder, which will:
     - Install `Poetry` - [Link](https://python-poetry.org/docs/#installation): The minimum required version is `1.2`. Ensure you can execute `poetry -V` and get `1.2`+
     - Run `poetry install` in the root directory, which will set up a `.venv` folder with a Python virtual environment and also install all Python dependencies
     - Copy `.env.template` to `.env`
3. Open the project and start debugging / developing via:
   - VS Code
     1. Open the repository root in VS Code
     2. Install recommended extensions
     3. Hit F5 (or whatever you have debug mapped to) while you have a contract open (default: `playground/hello_world/helloworld.py`) and it should by default (using the `Demo current contract (+ LocalNet)` configuration) start running the `demo.py`file in the same folder as that contract, which will start LocalNet, build the contract, and deploy the contract to LocalNet.
        > **Note**
        > If using Windows: Before running for the first time you will need to select the Python Interpreter.
        1. Open the command palette (Cmd/Ctrl + Shift + P)
        2. Search for `Python: Select Interpreter`
        3. Select `./.venv/Scripts/python.exe`
   - IDEA (e.g. PyCharm)
     1. Open the repository root in the IDE
     2. It should automatically detect it's a Poetry project and set up a Python interpreter and virtual environment.
     3. Hit Shift+F9 (or whatever you have debug mapped to) and it should start running with breakpoint debugging.
   - Other
     1. Open the repository root in your text editor of choice
     2. In a terminal run `poetry shell`
     3. Run `python playground/hello_world/demo.py` through your debugger of choice

### Subsequently

1. If you update to the latest source code and there are new dependencies you will need to run `algokit bootstrap all` again
2. Follow step 3 above
