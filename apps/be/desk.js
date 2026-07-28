export const desk = (S) =>
  S.list()
    .title('Diaa')
    .items([
      S.documentListItem().id('siteOptions').schemaType('siteOptions').title('Global'),

      S.divider(),

      S.documentListItem().id('pageHome').schemaType('pageHome').title('Home Page'),

      S.documentListItem().id('pageContact').schemaType('pageContact').title('Contact Page'),

      S.documentListItem().id('pageImprint').schemaType('pageImprint').title('Imprint Page'),

      S.divider(),

      S.listItem({
        title: 'Entries',
        id: 'details',
        schemaType: 'detail',
        child: () =>
          S.documentTypeList('detail')
            .title('Entries')
            .defaultOrdering([{field: 'title', direction: 'asc'}]),
      }),

      S.divider(),

      S.listItem({
        title: 'Taxonomies',
        id: 'taxonomies',
        schemaType: 'taxonomy',
        child: () =>
          S.documentTypeList('taxonomy')
            .title('Taxonomies')
            .defaultOrdering([{field: 'title', direction: 'asc'}]),
      }),
    ])
