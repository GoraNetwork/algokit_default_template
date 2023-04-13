from typing import Literal

import beaker
import pyteal as pt


# util method for converting an Int to u16 bytes
def to_u16(i: pt.Expr) -> pt.Expr:
    return pt.Suffix(pt.Itob(i), pt.Int(6))


def array_blueprint(app: beaker.Application) -> None:
    @app.external
    def sum_dynamic_array(
        v: pt.abi.DynamicArray[pt.abi.Uint64], *, output: pt.abi.Uint64
    ) -> pt.Expr:
        """sums the array of ints"""
        return pt.Seq(
            # Use a scratch var to store the running sum
            (running_sum := pt.ScratchVar(pt.TealType.uint64)).store(pt.Int(0)),
            # Iterate over the elements of the array
            pt.For(
                (i := pt.ScratchVar()).store(pt.Int(0)),
                i.load() < v.length(),
                i.store(i.load() + pt.Int(1)),
            ).Do(
                # Access the element with square bracket annotation
                # and call `use` on it to use the value since its a
                # computed type like tuple elements
                v[i.load()].use(
                    lambda val: running_sum.store(running_sum.load() + val.get())
                )
            ),
            # Set the value we're returning
            output.set(running_sum.load()),
        )

    # While its not advisable to make heavy use dynamic ABI
    # types within the logic of the contract due to the inefficient
    # access to elements, below are some examples of how you
    # might construct a larger array from 2 smaller ones
    @app.external
    def concat_static_arrays(
        a: pt.abi.StaticArray[pt.abi.Uint64, Literal[3]],
        b: pt.abi.StaticArray[pt.abi.Uint64, Literal[3]],
        *,
        output: pt.abi.StaticArray[pt.abi.Uint64, Literal[6]],
    ) -> pt.Expr:
        # Static arrays are easy to concat since there is no
        # length prefix or offsets to track. The typing of the
        # value includes the length explicitly.
        return output.decode(pt.Concat(a.encode(), b.encode()))

    @app.external
    def concat_dynamic_arrays(
        a: pt.abi.DynamicArray[pt.abi.Uint64],
        b: pt.abi.DynamicArray[pt.abi.Uint64],
        *,
        output: pt.abi.DynamicArray[pt.abi.Uint64],
    ) -> pt.Expr:
        """demonstrate how two dynamic arrays of static elements could be concat'd"""
        # A Dynamic array of static types is encoded as:
        # [uint16 length, element 0, element 1]
        # so to concat them, we must remove the 2 byte length prefix
        # from each, and prepend the new length (of elements!) as 2 byte integer
        return output.decode(
            pt.Concat(
                pt.Suffix(pt.Itob(a.length() + b.length()), pt.Int(6)),
                pt.Suffix(a.encode(), pt.Int(2)),
                pt.Suffix(b.encode(), pt.Int(2)),
            )
        )

    @app.external
    def concat_dynamic_string_arrays(
        a: pt.abi.DynamicArray[pt.abi.String],
        b: pt.abi.DynamicArray[pt.abi.String],
        *,
        output: pt.abi.DynamicArray[pt.abi.String],
    ) -> pt.Expr:
        """demonstrate how two dynamic arrays of dynamic elements could be concat'd"""
        # NOTE: this is not efficient (clearly), static types should
        # always be preferred if possible. Otherwise use some encoding
        # other than the abi encoding, which is more for serializing/deserializing data

        # A Dynamic array of dynamic types is encoded as:
        # [uint16 length, uint16 pos elem 0, uint16 pos elem 1, elem 0, elem 1]
        # so to concat them, we must remove the 2 byte length prefix
        # from each, and prepend the new length (of elements!) as 2 byte integer
        return pt.Seq(
            # Make a couple bufs for the header (offsets) and elements
            (_head_buf := pt.ScratchVar()).store(
                pt.Suffix(pt.Itob(a.length() + b.length()), pt.Int(6))
            ),
            # Take the element contents of the 2 arrays
            (_tail_buf := pt.ScratchVar()).store(
                pt.Concat(
                    # strip length and positions, now its [elem0, elem1, elem2]
                    pt.Suffix(a.encode(), pt.Int(2) + (pt.Int(2) * a.length())),
                    pt.Suffix(b.encode(), pt.Int(2) + (pt.Int(2) * b.length())),
                )
            ),
            # Create the offset value we'll use for the position header
            # we know the first string will start at 2 * combined length
            (offset := pt.ScratchVar()).store(((a.length() + b.length()) * pt.Int(2))),
            # We'll track the current string we're working on here
            (curr_str_len := pt.ScratchVar()).store(pt.Int(0)),
            (cursor := pt.ScratchVar()).store(pt.Int(0)),
            pt.While(
                (cursor.load() + curr_str_len.load()) <= pt.Len(_tail_buf.load())
            ).Do(
                # Add the offset for this string to the head buf
                _head_buf.store(pt.Concat(_head_buf.load(), to_u16(offset.load()))),
                # Get the length of the current string + 2 bytes for uint16 len
                curr_str_len.store(
                    pt.ExtractUint16(_tail_buf.load(), cursor.load()) + pt.Int(2)
                ),
                # update our cursor to point to the next str element
                cursor.store(cursor.load() + curr_str_len.load()),
                # update our offset similarly
                offset.store(offset.load() + curr_str_len.load()),
            ),
            output.decode(pt.Concat(_head_buf.load(), _tail_buf.load())),
        )
