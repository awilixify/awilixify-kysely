type IsUnion<Value, Whole = Value> = Value extends Whole
	? [Whole] extends [Value]
		? false
		: true
	: never;

// Open string/template types have no required concrete key. Names must identify one.
export type LiteralName<Name extends string> =
	Record<never, never> extends Record<Name, never>
		? never
		: true extends IsUnion<Name>
			? never
			: Name extends ""
				? never
				: Name;
