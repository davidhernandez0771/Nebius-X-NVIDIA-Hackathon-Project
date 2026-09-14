"""The smallest possible example. Run:  uv run python scripts/hello.py"""

from nebius_llm import chat

# 1. INPUT: a plain string. This is what gets sent to Nemotron.
question = "Give me one tip for staying calm after losing a tennis point. One sentence."

# 2. THE CALL: send it, wait, get a result object back.
result = chat(question, tier="nano")

# 3. OUTPUT: the model's reply is just text in result.text.
print("You asked: ", question)
print("It replied:", result.text)
print("Cost:      $%.5f" % result.est_cost_usd)
