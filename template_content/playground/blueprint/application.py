import beaker
from calculator_blueprint import calculator, add_n

# Create an Application named `blueprint`
app = beaker.Application("blueprint")

# Apply the blueprint to the application
# to register the methods defined in the blueprint
app.apply(calculator)


# Apply a blueprint that also takes arguments
# in this case, we pass n=5 to specify the
# value of n to add to the input number
app.apply(add_n, n=5)
