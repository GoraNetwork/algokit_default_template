import beaker
import pyteal as pt
from beaker import consts
from beaker.lib import storage

MAX_MEMBERS = 10


class BoxExampleState:
    # Declares a BoxMapping, where each key is an address and each value is a uint64
    # every new key creates a new box.
    balances = storage.BoxMapping(pt.abi.Address, pt.abi.Uint64)

    # Declares a BoxList, where each element is a 32 byte array and
    # creates a box with space for MAX_MEMBERS elements
    members = storage.BoxList(pt.abi.Address, MAX_MEMBERS)

    # Add a global state value to track the total count of elements in the box
    member_count = beaker.GlobalStateValue(pt.TealType.uint64)


app = beaker.Application("BoxExample", state=BoxExampleState())


@app.external
def bootstrap() -> pt.Expr:
    return pt.Seq(
        app.initialize_global_state(),
        # create returns a bool value indicating if the box was created
        # we just pop it here to discard it
        pt.Pop(app.state.members.create()),
    )


@app.external
def set_balance(addr: pt.abi.Address, amount: pt.abi.Uint64) -> pt.Expr:
    """Sets the balance of an address"""
    return app.state.balances[addr].set(amount)


@app.external(read_only=True)
def read_balance(addr: pt.abi.Address, *, output: pt.abi.Uint64) -> pt.Expr:
    return output.decode(app.state.balances[addr].get())


@app.external
def add_member(addr: pt.abi.Address) -> pt.Expr:
    """Adds a new member to the list"""
    return pt.Seq(
        pt.Assert(app.state.member_count < pt.Int(MAX_MEMBERS), comment="List is full"),
        app.state.members[app.state.member_count].set(addr),
        # Write a zero balance to the balance box
        # for this address
        app.state.balances[addr].set(pt.Itob(pt.Int(0))),
        app.state.member_count.increment(),
    )


@app.external
def fill_box(
    box_name: pt.abi.String, box_data: pt.abi.DynamicArray[pt.abi.String]
) -> pt.Expr:
    return pt.BoxPut(box_name.get(), box_data.encode())


def compute_min_balance(members: int):
    """Compute the min balance for the app to hold the boxes we need"""
    return (
        consts.ASSET_MIN_BALANCE  # Cover min bal for member token
        + (
            consts.BOX_FLAT_MIN_BALANCE
            + (pt.abi.size_of(pt.abi.Uint64) * consts.BOX_BYTE_MIN_BALANCE)
        )
        * members  # cover min bal for balance boxes we might create
        + (
            consts.BOX_FLAT_MIN_BALANCE
            + (members * pt.abi.size_of(pt.abi.Address) * consts.BOX_BYTE_MIN_BALANCE)
        )  # cover min bal for member list box
    )
