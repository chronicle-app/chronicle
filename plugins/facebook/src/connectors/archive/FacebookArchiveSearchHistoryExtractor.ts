import { Record } from '@chronicle.app/etl';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { FacebookArchiveExtractor } from './FacebookArchiveExtractor.js';
import FacebookTransformer from '../FacebookTransformer.js';

export class FacebookArchiveSearchHistoryExtractor extends FacebookArchiveExtractor {
  static override recordTypes = ['searches'];
  static override description = 'Search history';
  static override default = false;
  static override defaultTransformer = FacebookTransformer;

  async *extract(): AsyncGenerator<Record> {
    await this.initialize();

    const processedSearches = new Set<string>();
    let recordCount = 0;

    for await (const { fullPath } of this.iterateExportSegments()) {
      for await (const record of this.extractSearchHistoryFromSegment(
        fullPath,
        processedSearches
      )) {
        yield record;
        recordCount++;

        if (this.shouldStopExtracting(recordCount)) {
          return;
        }
      }
    }
  }

  private async *extractSearchHistoryFromSegment(
    segmentPath: string,
    processedSearches: Set<string>
  ): AsyncGenerator<Record> {
    const searchHistoryPath = join(
      segmentPath,
      'logged_information',
      'search',
      'your_search_history.json'
    );

    try {
      await stat(searchHistoryPath);
    } catch {
      // No search history file found
      return;
    }

    try {
      const data = await this.readFacebookJson(searchHistoryPath);
      yield* this.processSearchHistoryData(data, processedSearches);
    } catch {
      // Error reading search history file
    }
  }

  private async *processSearchHistoryData(
    data: any,
    processedSearches: Set<string>
  ): AsyncGenerator<Record> {
    if (!data.searches_v2 || !Array.isArray(data.searches_v2)) {
      // No searches_v2 array found in search history data
      return;
    }

    for (const search of data.searches_v2) {
      if (!search.timestamp) continue;

      // Skip searches outside date range if configured
      if (!this.isWithinDateRange(new Date(search.timestamp * 1000))) {
        continue;
      }

      const searchId = `search-${search.timestamp}-${this.hashSearchText(search)}`;

      // Skip if already processed (avoid duplicates)
      if (processedSearches.has(searchId)) {
        continue;
      }

      const processedSearch = this.parseSearchData(search, searchId);

      if (processedSearch) {
        yield this.createRecordWithArchiveContext(processedSearch, {
          searchType: 'facebook_search',
          dataSource: 'search_history',
        });

        processedSearches.add(searchId);
      }
    }
  }

  private parseSearchData(search: any, searchId: string): any | null {
    // Extract search text from multiple possible locations
    let searchText = '';
    let searchQuery = '';

    // Try to get search text from data array
    if (search.data && Array.isArray(search.data) && search.data[0]?.text) {
      searchText = search.data[0].text;
    }

    // Try to get search text from attachments
    if (search.attachments && Array.isArray(search.attachments)) {
      for (const attachment of search.attachments) {
        if (attachment.data && Array.isArray(attachment.data) && attachment.data[0]?.text) {
          searchQuery = attachment.data[0].text;
          // Remove quotes if present
          searchQuery = searchQuery.replace(/^"(.*)"$/, '$1');
          break;
        }
      }
    }

    // Use searchQuery if available, otherwise fallback to searchText
    const finalSearchText = searchQuery || searchText;

    if (!finalSearchText) {
      return null;
    }

    const searchType = this.determineSearchType(search.title || '');
    const isProfileSearch = this.isProfileSearch(finalSearchText, search.title || '');

    return {
      id: searchId,
      timestamp: this.convertFacebookTimestamp(search.timestamp * 1000),
      searchText: this.fixFacebookTextEncoding(finalSearchText),
      searchQuery: searchQuery ? this.fixFacebookTextEncoding(searchQuery) : null,
      title: search.title ? this.fixFacebookTextEncoding(search.title) : null,
      searchType,
      isProfileSearch,
      isVisited: (search.title || '').includes('visited'),
      isSearched: (search.title || '').includes('searched'),
      rawSearchText: searchText,
      hasAttachments: Boolean(search.attachments && search.attachments.length > 0),
      rawData: search,
    };
  }

  private determineSearchType(title: string): string {
    const lowerTitle = title.toLowerCase();

    if (lowerTitle.includes('visited')) return 'visit';
    if (lowerTitle.includes('searched')) return 'search';
    if (lowerTitle.includes('looked for')) return 'lookup';

    return 'unknown';
  }

  private isProfileSearch(searchText: string, title: string): boolean {
    // Check if this appears to be searching for a person
    const hasPersonIndicators = [
      /^[A-Z][a-z]+ [A-Z]/, // First Last name pattern
      title.includes('visited'),
      title.includes('profile'),
      !searchText.includes(' ') && searchText.length > 2, // Single word that might be a name
    ];

    return hasPersonIndicators.some(indicator =>
      typeof indicator === 'boolean' ? indicator : indicator.test(searchText)
    );
  }

  private hashSearchText(search: any): string {
    // Create a simple hash of the search content for deduplication
    const content = JSON.stringify({
      data: search.data,
      attachments: search.attachments,
      title: search.title,
    });

    // Simple hash function
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.codePointAt(i) ?? 0;
      hash = (hash * 33 + char) % 2_147_483_647; // Simple hash without bitwise operators
    }
    return Math.abs(hash).toString(36);
  }
}
