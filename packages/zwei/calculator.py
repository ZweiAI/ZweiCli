import re


def calculate(expr: str) -> float:
    expr = expr.replace(" ", "")

    def parse(text: str) -> list:
        tokens = re.findall(r"[\d.]+|[+\-*/()]", text)
        return tokens

    def eval_tokens(tokens: list) -> float:
        def parse_expr(tokens: list) -> tuple:
            if not tokens:
                raise ValueError("Empty expression")

            token = tokens[0]

            if token == "(":
                depth = 0
                for i, t in enumerate(tokens):
                    if t == "(":
                        depth += 1
                    elif t == ")":
                        depth -= 1
                        if depth == 0:
                            result, remaining = parse_expr(tokens[1:i])
                            return result, tokens[i + 1 :]
                raise ValueError("Mismatched parentheses")

            return parse_add_sub(tokens)

        def parse_add_sub(tokens: list) -> tuple:
            left, tokens = parse_mul_div(tokens)

            while tokens and tokens[0] in "+-":
                op = tokens[0]
                right, tokens = parse_mul_div(tokens[1:])
                left = left + right if op == "+" else left - right

            return left, tokens

        def parse_mul_div(tokens: list) -> tuple:
            left, tokens = parse_unary(tokens)

            while tokens and tokens[0] in "*/":
                op = tokens[0]
                right, tokens = parse_unary(tokens[1:])
                left = left * right if op == "*" else left / right

            return left, tokens

        def parse_unary(tokens: list) -> tuple:
            if tokens and tokens[0] == "-":
                val, tokens = parse_unary(tokens[1:])
                return -val, tokens
            return parse_add_sub(tokens)

        result, remaining = parse_add_sub(tokens)
        if remaining:
            raise ValueError(f"Unexpected tokens: {remaining}")
        return result

    return eval_tokens(parse(expr))


def main():
    print("Calculator (type 'quit' to exit)")
    print("Supported: + - * / ( )")

    while True:
        expr = input("\n> ")
        if expr.lower() in ("quit", "exit", "q"):
            break
        try:
            result = calculate(expr)
            print(f"= {result}")
        except Exception as e:
            print(f"Error: {e}")


if __name__ == "__main__":
    main()
