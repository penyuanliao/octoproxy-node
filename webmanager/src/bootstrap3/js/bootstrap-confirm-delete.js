/**
 * Bootstrap Confirm Delete
 * Author: Tom Kaczocha <tom@rawphp.org>
 * Licensed under the MIT license
 */

;
( function ( $, window, document, undefined )
{
    var bootstrap_confirm_delete = function ( element, options )
    {
        this.element = $( element );
        this.settings = $.extend(
            {
                debug: false,
                heading: 'Delete',
                message: 'Are you sure you want to delete this item?',
                btn_ok_label: 'Yes',
                btn_cancel_label: 'Cancel',
                data_type: null,
                callback: null,
                delete_callback: null,
                cancel_callback: null,
            }, options || {}
        );

        this.onDelete = function ( event )
        {
            event.preventDefault();

            var plugin = $( this ).data( 'bootstrap_confirm_delete' );

            if ( undefined !== $( this ).attr( 'data-type' ) )
            {
                var name = $( this ).attr( 'data-type' );

                plugin.settings.heading = 'Delete ' + name[ 0 ].toUpperCase() + name.substr( 1 );
                plugin.settings.message = 'Are you sure you want to delete this ' + name + '?';
            }

            if ( null === document.getElementById( 'bootstrap-confirm-delete-container' ) )
            {
                $( 'body' ).append( '<div id="bootstrap-confirm-delete-container"><div id="bootstrap-confirm-dialog" class="modal fade"><div class="modal-dialog modal-sm"><div class="modal-content"><div class="modal-header"><button type="button" class="close" data-dismiss="modal"><span aria-hidden="true">&times;</span><span class="sr-only">Close</span></button><h4 id="bootstrap-confirm-dialog-heading"></h4></div><div class="modal-body"><p id="bootstrap-confirm-dialog-text"></p></div><div class="modal-footer"><button id="bootstrap-confirm-dialog-cancel-delete-btn" type="button" class="btn btn-default pull-left" data-dismiss="modal">Cancel</button><a id="bootstrap-confirm-dialog-delete-btn" href="#" class="btn btn-danger pull-right">Delete</a></div></div></div></div></div>' );
            }

            $( '#bootstrap-confirm-dialog-heading' ).html( plugin.settings.heading );
            $( '#bootstrap-confirm-dialog-text' ).html( plugin.settings.message );
            $( '#bootstrap-confirm-dialog-delete-btn' ).html( plugin.settings.btn_ok_label );
            $( '#bootstrap-confirm-dialog-cancel-delete-btn' ).html( plugin.settings.btn_cancel_label );
            $( '#bootstrap-confirm-dialog' ).modal( 'toggle' );

            var deleteBtn = $( 'a#bootstrap-confirm-dialog-delete-btn' );
            var cancelBtn = $( 'a#bootstrap-confirm-dialog-cancel-delete-btn' );
            var hasCallback = false;

            if ( null !== plugin.settings.callback )
            {
                if ( $.isFunction( plugin.settings.callback ) )
                {
                    deleteBtn.attr( 'data-dismiss', 'modal' ).off('.bs-confirm-delete').on( 'click.bs-confirm-delete', { originalObject: $( this ) }, plugin.settings.callback );
                    hasCallback = true;
                }
                else
                {
                    console.log( plugin.settings.callback + ' is not a valid callback' );
                }
            }
            if ( null !== plugin.settings.delete_callback )
            {
                if ( $.isFunction( plugin.settings.delete_callback ) )
                {
                    deleteBtn.attr( 'data-dismiss', 'modal' ).off('.bs-confirm-delete').on( 'click.bs-confirm-delete', { originalObject: $( this ) }, plugin.settings.delete_callback );
                    hasCallback = true;
                }
                else
                {
                    console.log( plugin.settings.delete_callback + ' is not a valid callback' );
                }
            }
            if ( !hasCallback &&  '' !== event.currentTarget.href )
            {
                deleteBtn.attr( 'href', event.currentTarget.href );
            }

            if ( null !== plugin.settings.cancel_callback )
            {
                cancelBtn.off('.bs-confirm-delete').on( 'click.bs-confirm-delete', { originalObject: $( this ) }, plugin.settings.cancel_callback );
            }
        };
    };

    $.fn.bootstrap_confirm_delete = function ( options )
    {
        return this.each( function ()
        {
            var element = $( this );

            if ( element.data( 'bootstrap_confirm_delete' ) )
            {
                return element.data( 'bootstrap_confirm_delete' );
            }

            var plugin = new bootstrap_confirm_delete( this, options );

            element.data( 'bootstrap_confirm_delete', plugin );
            element.off('.bs-confirm-delete').on( 'click.bs-confirm-delete', plugin.onDelete );

            return plugin;
        } );
    };

    var bootstrap_confirm_shutdown = function ( element, options )
    {
        this.element = $( element );
        this.settings_sd = $.extend(
            {
                debug: false,
                heading: 'Delete',
                message: 'Are you sure you want to delete this item?',
                btn_ok_label: 'restart',
                btn_gracefully_label: 'gracefully',
                btn_cancel_label: 'Cancel',
                data_type: null,
                callback: null,
                delete_callback: null,
                gracefully_callback: null,
                cancel_callback: null,
            }, options || {}
        );

        this.onDelete = function ( event )
        {
            event.preventDefault();

            var plugin = $( this ).data( 'bootstrap_confirm_shutdown' );
            var settings = plugin.settings_sd;
            if ( undefined !== $( this ).attr( 'data-type' ) )
            {
                var name = $( this ).attr( 'data-type' );

                settings.heading = 'Delete ' + name[ 0 ].toUpperCase() + name.substr( 1 );
                settings.message = 'Are you sure you want to delete this ' + name + '?';
            }

            if ( null === document.getElementById( 'bootstrap-confirm-shutdown-container' ) )
            {
                $( 'body' ).append( '<div id="bootstrap-confirm-shutdown-container">' +
                    '<div id="bootstrap-confirm-dialog2" class="modal fade">' +
                    '<div class="modal-dialog modal-sm">' +
                    '<div class="modal-content">' +
                    '<div class="modal-header">' +
                    '<button type="button" class="close" data-dismiss="modal">' +
                    '<span aria-hidden="true">&times;</span>' +
                    '<span class="sr-only">Close</span>' +
                    '</button>' +
                    '<h4 id="bootstrap-confirm-dialog-heading2"></h4>' +
                    '</div>' +
                    '<div class="modal-body">' +
                    '<p id="bootstrap-confirm-dialog-text2"></p>' +
                    '</div><div class="modal-footer">' +
                    '<button id="bootstrap-confirm-dialog-cancel-delete-btn2" type="button" class="btn btn-default pull-left" data-dismiss="modal">Cancel</button>' +
                    '<a id="bootstrap-confirm-dialog-delete-btn2" href="#" class="btn btn-danger pull-right">Delete</a>' +
                    '<a id="bootstrap-confirm-dialog-gracefully-btn2" href="#" class="btn btn-primary pull-right">gracefully</a>' +
                    '</div>' +
                    '</div>' +
                    '</div>' +
                    '</div>' +
                    '</div>' );
            }

            $( '#bootstrap-confirm-dialog-heading2' ).html( settings.heading );
            $( '#bootstrap-confirm-dialog-text2' ).html( settings.message );
            $( '#bootstrap-confirm-dialog-gracefully-btn2' ).html( settings.btn_gracefully_label );
            $( '#bootstrap-confirm-dialog-delete-btn2' ).html( settings.btn_ok_label );
            $( '#bootstrap-confirm-dialog-cancel-delete-btn2' ).html( settings.btn_cancel_label );
            $( '#bootstrap-confirm-dialog2' ).modal( 'toggle' );

            var deleteBtn = $( 'a#bootstrap-confirm-dialog-delete-btn2' );
            var cancelBtn = $( 'a#bootstrap-confirm-dialog-cancel-delete-btn2' );
            var gracefullyBtn = $( 'a#bootstrap-confirm-dialog-gracefully-btn2' );
            var hasCallback = false;

            if ( null !== settings.callback )
            {
                if ( $.isFunction( settings.callback ) )
                {
                    deleteBtn.attr( 'data-dismiss', 'modal' ).off('.bs-confirm-delete').on( 'click.bs-confirm-delete', { originalObject: $( this ) }, settings.callback );
                    hasCallback = true;
                }
                else
                {
                    console.log( settings.callback + ' is not a valid callback' );
                }
            }
            if ( null !== settings.delete_callback )
            {
                if ( $.isFunction( settings.delete_callback ) )
                {
                    deleteBtn.attr( 'data-dismiss', 'modal' ).off('.bs-confirm-delete').on( 'click.bs-confirm-delete', { originalObject: $( this ) }, settings.delete_callback );
                    hasCallback = true;
                }
                else
                {
                    console.log( settings.delete_callback + ' is not a valid callback' );
                }
            }
            if ( null !== settings.gracefully_callback )
            {
                if ( $.isFunction( settings.gracefully_callback ) )
                {
                    gracefullyBtn.attr( 'data-dismiss', 'modal' ).off('.bs-confirm-delete').on( 'click.bs-confirm-delete', { originalObject: $( this ) }, settings.gracefully_callback );
                    hasCallback = true;
                }
                else
                {
                    console.log( settings.gracefully_callback + ' is not a valid callback' );
                }
            }
            if ( !hasCallback &&  '' !== event.currentTarget.href )
            {
                deleteBtn.attr( 'href', event.currentTarget.href );
                gracefullyBtn.attr( 'href', event.currentTarget.href );
            }

            if ( null !== settings.cancel_callback )
            {
                cancelBtn.off('.bs-confirm-delete').on( 'click.bs-confirm-delete', { originalObject: $( this ) }, settings.cancel_callback );
            }

        };
    };

    $.fn.bootstrap_confirm_shutdown = function ( options )
    {
        return this.each( function ()
        {
            var element = $( this );

            if ( element.data( 'bootstrap_confirm_shutdown' ) )
            {
                return element.data( 'bootstrap_confirm_shutdown' );
            }

            var plugin = new bootstrap_confirm_shutdown( this, options );

            element.data( 'bootstrap_confirm_shutdown', plugin );
            element.off('.bs-confirm-delete').on( 'click.bs-confirm-delete', plugin.onDelete );

            return plugin;
        } );
    };

}( jQuery, window, document, undefined ));
