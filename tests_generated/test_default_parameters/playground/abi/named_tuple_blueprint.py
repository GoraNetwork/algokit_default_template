import beaker
import pyteal as pt


class StructyTuple(pt.abi.NamedTuple):
    # Note that the type is wrapped in a `pt.abi.Field`
    a: pt.abi.Field[pt.abi.Uint64]
    b: pt.abi.Field[pt.abi.Uint64]


def named_tuple_blueprint(app: beaker.Application) -> None:
    @app.external
    def sum_tuple_elements_with_use(
        t: StructyTuple, *, output: pt.abi.Uint64
    ) -> pt.Expr:
        """sum the elements of the tuple with `use` and lambda"""
        return pt.Seq(
            (running_sum := pt.ScratchVar(pt.TealType.uint64)).store(pt.Int(0)),
            # we can pass a lambda into the `use` method to access the value
            # as the abi type it was declared as
            t.a.use(lambda a: running_sum.store(running_sum.load() + a.get())),
            t.b.use(lambda b: running_sum.store(running_sum.load() + b.get())),
            output.set(running_sum.load()),
        )

    @app.external
    def sum_tuple_elements_with_store_into(
        t: StructyTuple, *, output: pt.abi.Uint64
    ) -> pt.Expr:
        """sum the elements of the tuple with `.set` on matching abi type"""
        return pt.Seq(
            # we can pass the tuple element into a `set` method for the same type
            # under the covers this calls the `store_into` method on the element
            # with the abi type as the argument
            (a := pt.abi.Uint64()).set(t.a),
            (b := pt.abi.Uint64()).set(t.b),
            output.set(a.get() + b.get()),
        )
