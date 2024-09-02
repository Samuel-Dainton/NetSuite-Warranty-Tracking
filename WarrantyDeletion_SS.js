/**
 * @NApiVersion 2.x
 * @NScriptType ScheduledScript
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/search', 'N/log'], function(record, search, log) {

    function execute(context) {
        log.debug('Script Started');

        try {
            // Define the search to find all warranty records
            var warrantySearch = search.create({
                type: 'customrecord_wrm_warrantyreg', // Replace with your custom record type ID
                filters: [],
                columns: ['internalid']
            });

            // Run the search and delete each record found
            warrantySearch.run().each(function(result) {
                var warrantyRecordId = result.getValue('internalid');
                log.debug('Deleting Warranty Record ID: ' + warrantyRecordId);

                // Delete the record
                record.delete({
                    type: 'customrecord_wrm_warrantyreg', // Replace with your custom record type ID
                    id: warrantyRecordId
                });

                return true; // Continue processing the search results
            });

            log.debug('Script Completed');
        } catch (e) {
            log.error('Error Deleting Warranty Records', e.toString());
        }
    }

    return {
        execute: execute
    };

});