import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

const suppressionPattern = /@ts-ignore|@ts-expect-error|eslint-disable(?:-next-line|-line)?/u;

const noSuppression = {
  meta: {
    type: "problem",
    docs: { description: "Disallow TypeScript and ESLint suppression comments." },
    schema: [],
    messages: { forbidden: "Suppression comments are forbidden in the quality profile." },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (suppressionPattern.test(comment.value)) {
            context.report({ loc: comment.loc, messageId: "forbidden" });
          }
        }
      },
    };
  },
};

/**
 * The deterministic, blocking lint profile for a Next.js + Supabase consumer.
 * Consumers own their product rules; this profile only owns stack and safety rules.
 */
export function nextSupabaseQualityProfile() {
  return [
    eslintConfigPrettier,
    ...tseslint.configs.strictTypeChecked,
    {
      files: ["**/*.{ts,tsx}"],
      languageOptions: {
        parserOptions: { projectService: true },
      },
      plugins: { foundation: { rules: { "no-suppression": noSuppression } } },
      rules: {
        "@typescript-eslint/no-explicit-any": "error",
        "@typescript-eslint/no-non-null-assertion": "error",
        "@typescript-eslint/no-unsafe-argument": "error",
        "@typescript-eslint/no-unsafe-assignment": "error",
        "@typescript-eslint/no-unsafe-call": "error",
        "@typescript-eslint/no-unsafe-member-access": "error",
        "@typescript-eslint/no-unsafe-return": "error",
        "foundation/no-suppression": "error",
        "no-restricted-syntax": [
          "error",
          {
            selector: "TSAsExpression:not([typeAnnotation.typeName.name='const'])",
            message: "Type assertions are forbidden; narrow unknown instead.",
          },
          { selector: "TSTypeAssertion", message: "Type assertions are forbidden; narrow unknown instead." },
        ],
      },
    },
  ];
}

/**
 * Create one explicit import boundary. The consumer supplies both its layer
 * path and the forbidden imports, so Foundation does not prescribe an
 * application architecture.
 */
export function architectureImportBoundary({ files, restrictedPatterns, message }) {
  return {
    files,
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: restrictedPatterns, message }] },
      ],
    },
  };
}

export default nextSupabaseQualityProfile();
