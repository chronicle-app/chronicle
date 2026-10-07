import { ChronicleTransformer, Record } from '@chronicle.app/etl';
import { ActionAndChildren, EatAction, DrankAction, Meal, Agent } from '@chronicle.app/schema';
import { buildICloudPersonSchema, type ICloudAccount } from '@chronicle.app/icloud';

/**
 * Conservative seed list of common beverages, matched whole-word against an
 * entry's name. FoodNoms records NO food-vs-drink flag — verified there is no
 * category column anywhere in the database — so eat-vs-drink can only be
 * inferred. This list is intentionally coarse and high-precision (it will miss
 * non-English/brand-name drinks and may catch e.g. "coffee cake"); it is a
 * placeholder, not truth. The authoritative drink vocabulary is meant to be the
 * user's own historical `drank X` log: when that data is imported, the set of
 * objects it labels as drunk should supersede and extend this seed. The action
 * is keyed without `@type` (see buildMealActions) precisely so this label can be
 * re-derived without changing a consumption's identity.
 */
const DRINK_WORDS = new Set([
  'water',
  'coffee',
  'espresso',
  'latte',
  'cappuccino',
  'americano',
  'macchiato',
  'mocha',
  'frappuccino',
  'tea',
  'chai',
  'matcha',
  'juice',
  'soda',
  'pop',
  'cola',
  'lemonade',
  'kombucha',
  'smoothie',
  'milkshake',
  'milk',
  'beer',
  'lager',
  'ale',
  'ipa',
  'stout',
  'cider',
  'wine',
  'prosecco',
  'champagne',
  'sake',
  'cocktail',
  'margarita',
  'martini',
  'mojito',
  'whiskey',
  'whisky',
  'vodka',
  'gin',
  'rum',
  'tequila',
  'brandy',
  'liqueur',
]);

export default class FoodNomsTransformer extends ChronicleTransformer {
  async transform(record: Record): Promise<ActionAndChildren[]> {
    const actions: ActionAndChildren[] = [];

    if (record.extraction.recordType === 'meals') {
      actions.push(...(await this.buildMealActions(record)));
    }

    return actions;
  }

  private async buildMealActions(record: Record): Promise<ActionAndChildren[]> {
    const meal: Meal = this.buildMeal(record.data, record.context);
    const user: Agent = await this.buildUser(record.context.account);

    // One consume action per logged food entry. FoodNoms gives a single point in
    // time (`date`), not a span, so it lands on `timestamp` rather than endTime.
    //
    // Identity is the consumption of this entry — keyed on the real entryID — and
    // `@type` is deliberately left OUT of the @key: eat-vs-drink is an inferred,
    // revisable label (see DRINK_WORDS), so reclassifying must not mint a new
    // action. This also keeps FoodNoms consumptions shaped like the historical
    // `ate X` / `drank X` log so the two can sit on one timeline.
    const shared = {
      timestamp: new Date(record.data.date),
      '@key': ['source', 'sourceId'],
      source: 'foodnoms',
      sourceId: record.data.entryID,
      agent: user,
      object: meal,
    };

    const action: (EatAction | DrankAction) & ActionAndChildren = this.isDrink(record.data.name)
      ? { '@type': 'DrankAction', ...shared }
      : { '@type': 'EatAction', ...shared };

    return [action];
  }

  /** Coarse, revisable eat-vs-drink inference; see DRINK_WORDS. */
  private isDrink(name: string | null | undefined): boolean {
    if (!name) return false;
    return name
      .toLowerCase()
      .split(/[^a-z]+/)
      .some(word => DRINK_WORDS.has(word));
  }

  /**
   * FoodNoms is a local single-user app, and the database carries no identity of
   * its own, so the eater is the device owner — the same iCloud Person the other
   * macOS plugins resolve, which lets "me" merge across sources.
   */
  private buildUser(account: ICloudAccount | null | undefined): Promise<Agent> {
    return buildICloudPersonSchema(account) as unknown as Promise<Agent>;
  }

  private buildMeal(data: any, context: any): Meal {
    // Key on `entryID`, the per-log CloudKit UUID FoodNoms assigns each entry.
    // `foodID` looks like a shared food reference but for the dominant namespaces
    // (`openai:` AI lookups, `local:` manual foods) it is a fresh UUID minted per
    // entry, so it neither dedupes repeats nor is a real cross-log identity —
    // using it would elevate a synthetic id to entity identity.
    const meal: Meal = {
      '@type': 'Meal',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'foodnoms',
      sourceId: data.entryID,
      name: data.name,
    };

    // Classify the meal slot (Breakfast/Lunch/Dinner/Snacks) when known.
    // `category` is the closed-classification characterization property; the slot
    // name is resolved upstream (built-in id→name map, or a custom mealTypeRecord
    // name) and is null for unnamed custom slots, which go uncategorized.
    if (context.mealType?.name) {
      meal.category = [context.mealType.name];
    }

    // Add meal type name and brand to description if available
    const descriptions = [];
    if (context.mealType?.name) {
      descriptions.push(context.mealType.name);
    }

    if (data.brandOwner) {
      descriptions.push(`Brand: ${data.brandOwner}`);
    }

    if (data.quantity && data.baseUnit) {
      descriptions.push(`${data.quantity} ${data.baseUnit}`);
    }

    if (data.calories) {
      descriptions.push(`${data.calories} calories`);
    }

    if (descriptions.length > 0) {
      meal.description = descriptions.join(' - ');
    }

    return meal;
  }
}
